import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import Fuse from 'fuse.js';
import { DialogModule } from 'primeng/dialog';
import { fileNameOf, FILE_KIND_ICONS, fileKindOf } from '@domain/files';
import { CaptureService } from '../capture/capture.service';
import { CatalogStore } from '../catalog/catalog.store';
import { SearchApi } from '../search/search.api';
import { ThemeService } from '../theme/theme.service';
import { viewerCommands } from '../../shared/files/file-row';
import {
  ACTION_ITEMS,
  catalogItems,
  PAGE_ITEMS,
  PALETTE_PREFIXES,
  PALETTE_SECTIONS,
  type PaletteAction,
  type PaletteItem,
  type PaletteSection,
} from './palette-items';
import { PaletteService } from './palette.service';

const MAX_PER_SECTION = 6;
const MAX_FILES = 8;
const FILE_DEBOUNCE_MS = 250;
const MIN_FILE_QUERY = 2;
const FUZZY_THRESHOLD = 0.35;
const ALL_START = '1970-01-01';
const ALL_END = '2999-12-31';

/** Grouped results. */
interface PaletteGroup {
  readonly section: PaletteSection;
  readonly items: readonly PaletteItem[];
}

/** Ctrl/Cmd+K palette: pages, actions, files, projects, tags and people. */
@Component({
  selector: 'ac-command-palette',
  imports: [FormsModule, DialogModule],
  templateUrl: './command-palette.component.html',
  styleUrl: './command-palette.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommandPaletteComponent {
  protected readonly palette = inject(PaletteService);
  private readonly catalog = inject(CatalogStore);
  private readonly search = inject(SearchApi);
  private readonly capture = inject(CaptureService);
  private readonly theme = inject(ThemeService);
  private readonly router = inject(Router);
  private fileAbort: AbortController | null = null;
  private fileTimer: ReturnType<typeof setTimeout> | null = null;

  protected readonly query = signal('');
  protected readonly active = signal(0);
  protected readonly fileItems = signal<readonly PaletteItem[]>([]);

  private readonly scope = computed<PaletteSection | null>(
    () => PALETTE_PREFIXES[this.query().charAt(0)] ?? null,
  );
  private readonly text = computed(() =>
    (this.scope() === null ? this.query() : this.query().slice(1)).trim(),
  );
  private readonly fuse = computed(
    () =>
      new Fuse(
        [
          ...ACTION_ITEMS,
          ...PAGE_ITEMS,
          ...catalogItems(
            this.catalog.projectList(),
            this.catalog.tagList(),
            this.catalog.contactList(),
          ),
        ],
        {
          keys: ['label', 'hint'],
          threshold: FUZZY_THRESHOLD,
        },
      ),
  );

  protected readonly groups = computed<readonly PaletteGroup[]>(() => {
    const scope = this.scope();
    const text = this.text();
    const matches =
      text === ''
        ? [...ACTION_ITEMS, ...PAGE_ITEMS]
        : this.fuse()
            .search(text)
            .map((result) => result.item);
    const all = [...matches, ...(scope === null || scope === 'Files' ? this.fileItems() : [])];
    return PALETTE_SECTIONS.filter((section) => scope === null || section === scope)
      .map((section) => ({
        section,
        items: all.filter((item) => item.section === section).slice(0, MAX_PER_SECTION),
      }))
      .filter((group) => group.items.length > 0);
  });

  protected readonly flat = computed(() => this.groups().flatMap((group) => group.items));

  /** Reset on open, search files while typing. */
  constructor() {
    effect(() => {
      if (this.palette.open()) {
        untracked(() => {
          this.query.set('');
          this.fileItems.set([]);
        });
      }
    });
    effect(() => {
      const text = this.text();
      const scope = this.scope();
      untracked(() => {
        this.active.set(0);
        this.scheduleFileSearch(scope === null ? text : '');
      });
    });
  }

  /**
   * Keyboard navigation.
   *
   * @param event - Key event.
   */
  protected onKey(event: KeyboardEvent): void {
    const count = this.flat().length;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      this.active.set(count === 0 ? 0 : (this.active() + step + count) % count);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const item = this.flat()[this.active()];
      if (item !== undefined) {
        this.choose(item);
      }
    }
  }

  /**
   * Index of an item in the flat list.
   *
   * @param item - Item.
   * @returns Index.
   */
  protected indexOf(item: PaletteItem): number {
    return this.flat().indexOf(item);
  }

  /**
   * Run an entry.
   *
   * @param item - Entry.
   */
  protected choose(item: PaletteItem): void {
    this.palette.open.set(false);
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    const target = item.target;
    if (target.kind === 'route') {
      void this.router.navigate(
        [...target.commands],
        target.query === undefined ? {} : { queryParams: target.query },
      );
      return;
    }
    this.runAction(target.action);
  }

  /**
   * Run a built-in action.
   *
   * @param action - Action.
   */
  private runAction(action: PaletteAction): void {
    switch (action) {
      case 'new-note':
        void this.router.navigate(['/notes'], { queryParams: { create: '1' } });
        return;
      case 'upload':
        this.capture.openUpload();
        return;
      case 'voice':
        this.capture.openVoice();
        return;
      case 'theme':
        this.theme.cycle();
        return;
    }
  }

  /**
   * Debounced quick file search by name.
   *
   * @param text - Query.
   */
  private scheduleFileSearch(text: string): void {
    if (this.fileTimer !== null) {
      clearTimeout(this.fileTimer);
    }
    this.fileAbort?.abort();
    if (text.length < MIN_FILE_QUERY) {
      this.fileItems.set([]);
      return;
    }
    this.fileTimer = setTimeout(() => void this.searchFiles(text), FILE_DEBOUNCE_MS);
  }

  /**
   * Search files by name (quick mode, all dates).
   *
   * @param text - Query.
   */
  private async searchFiles(text: string): Promise<void> {
    const abort = new AbortController();
    this.fileAbort = abort;
    const found: PaletteItem[] = [];
    const query = {
      text,
      startDate: ALL_START,
      endDate: ALL_END,
      mode: 0 as const,
      semantic: false,
      similarityThreshold: 0,
      folders: { values: [], exclude: false },
      mimes: { values: [], exclude: false },
      projects: { values: [], exclude: false },
      tags: { values: [], exclude: false },
    };
    try {
      for await (const event of this.search.stream(query, abort.signal)) {
        if (event.type === 'result' && found.length < MAX_FILES) {
          found.push(this.fileItem(event.path));
          this.fileItems.set([...found]);
        }
      }
    } catch {
      // Aborted by a newer query, or search unavailable: keep current results.
    }
  }

  /**
   * Palette entry of a file.
   *
   * @param path - Shared path.
   * @returns Entry.
   */
  private fileItem(path: string): PaletteItem {
    return {
      id: `f:${path}`,
      section: 'Files',
      label: fileNameOf(path),
      hint: path.split('/')[2] ?? '',
      icon: FILE_KIND_ICONS[fileKindOf(path)],
      target: { kind: 'route', commands: viewerCommands(path) },
    };
  }
}
