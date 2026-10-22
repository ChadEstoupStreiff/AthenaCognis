import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  resource,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import type { Options } from 'vis-network/standalone';
import type { FileLink, LinkSuggestion } from '@domain/contracts';
import { fileNameOf } from '@domain/files';
import { FileDetailsApi } from '../../core/files/file-details.api';
import { JobsStore } from '../../core/jobs/jobs.store';
import { NotifyService } from '../../core/notify/notify.service';
import { DataSync } from '../../core/state/data-sync.service';
import { FilePickerDialogComponent } from '../../shared/files/file-picker-dialog.component';
import { viewerCommands } from '../../shared/files/file-row';
import { GraphComponent } from '../../shared/ui/graph.component';
import { buildLinkGraph } from './link-graph';
import { MarkdownViewComponent } from '../../shared/ui/markdown-view.component';
import { OperationProgressDialogComponent } from '../../shared/ui/operation-progress-dialog.component';

const MAX_TREE_FILES = 150;
const DEFAULT_FORCE = 1;
const SUGGESTION_PRESELECT = 0.5;
const GRAPH_HEIGHT = 320;
const GRAPH_OPTIONS: Options = {
  physics: { stabilization: { iterations: 150 } },
  interaction: { hover: true },
  nodes: { font: { size: 12 } },
  edges: { color: { opacity: 0.6 }, smooth: false },
};

/** A suggestion being reviewed. */
interface ReviewedSuggestion {
  readonly suggestion: LinkSuggestion;
  readonly accepted: boolean;
}

/** Links of a file: list, graph, manual add and AI suggestions. */
@Component({
  selector: 'ac-links-tab',
  imports: [
    FormsModule,
    RouterLink,
    ButtonModule,
    CheckboxModule,
    InputNumberModule,
    InputTextModule,
    ToggleSwitchModule,
    FilePickerDialogComponent,
    GraphComponent,
    MarkdownViewComponent,
    OperationProgressDialogComponent,
  ],
  templateUrl: './links-tab.component.html',
  styleUrl: './inspector.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LinksTabComponent {
  private readonly details = inject(FileDetailsApi);
  private readonly notify = inject(NotifyService);
  private readonly jobs = inject(JobsStore);
  private readonly sync = inject(DataSync);
  private readonly router = inject(Router);

  /** Shared path. */
  readonly path = input.required<string>();

  protected readonly fullTree = signal(false);
  protected readonly pickerMode = signal<'link' | 'suggest' | null>(null);
  protected readonly force = signal(DEFAULT_FORCE);
  protected readonly comment = signal('');
  /** Operation id of the AI suggestion run shown in the progress dialog. */
  private readonly suggestId = signal<string | null>(null);
  /** Name of the candidate being assessed. */
  protected readonly suggestCurrent = signal<string | null>(null);
  /** AI suggestion run shown in the progress dialog. */
  protected readonly suggestOperation = computed(() => {
    const id = this.suggestId();
    return id === null ? null : (this.jobs.operations().find((op) => op.id === id) ?? null);
  });
  protected readonly suggesting = computed(() => this.suggestOperation()?.status === 'running');
  protected readonly review = linkedSignal<string, readonly ReviewedSuggestion[]>({
    source: this.path,
    computation: () => [],
  });
  protected readonly graphOptions = GRAPH_OPTIONS;
  protected readonly graphHeight = GRAPH_HEIGHT;

  protected readonly links = resource({
    params: () => ({ path: this.path(), version: this.sync.version('links')() }),
    loader: ({ params }) => this.details.links(params.path),
  });

  protected readonly graph = resource({
    params: () => ({ path: this.path(), full: this.fullTree(), links: this.links.value() ?? [] }),
    loader: ({ params }) => this.explore(params.path, params.links, params.full),
  });

  protected readonly graphData = computed(() => this.graph.value() ?? { nodes: [], edges: [] });

  /**
   * File name of a path.
   *
   * @param path - Path.
   * @returns Name.
   */
  protected nameOf(path: string): string {
    return fileNameOf(path);
  }

  /**
   * Viewer route of a path.
   *
   * @param path - Path.
   * @returns Router commands.
   */
  protected linkTo(path: string): string[] {
    return viewerCommands(path);
  }

  /**
   * Open a graph node.
   *
   * @param path - Clicked file.
   */
  protected openNode(path: string): void {
    if (path !== this.path()) {
      void this.router.navigate(viewerCommands(path));
    }
  }

  /**
   * Handle files chosen in the picker.
   *
   * @param paths - Picked files.
   */
  protected async onPicked(paths: readonly string[]): Promise<void> {
    const targets = paths.filter((path) => path !== this.path());
    if (this.pickerMode() === 'suggest') {
      this.suggest(targets);
      return;
    }
    for (const target of targets) {
      await this.details.addLink(this.path(), target, this.force(), this.comment());
    }
    this.comment.set('');
    this.notify.success(`${String(targets.length)} link(s) added.`);
  }

  /**
   * Remove a link.
   *
   * @param link - Link.
   */
  protected async remove(link: FileLink): Promise<void> {
    await this.details.removeLink(this.path(), link.other);
  }

  /**
   * Toggle a suggestion.
   *
   * @param index - Suggestion index.
   */
  protected toggleSuggestion(index: number): void {
    this.review.update((items) =>
      items.map((item, position) =>
        position === index ? { ...item, accepted: !item.accepted } : item,
      ),
    );
  }

  /** Save accepted suggestions. */
  protected async saveSuggestions(): Promise<void> {
    const accepted = this.review().filter((item) => item.accepted);
    for (const { suggestion } of accepted) {
      await this.details.addLink(
        suggestion.fileA,
        suggestion.fileB,
        suggestion.force,
        suggestion.comment,
      );
    }
    this.review.set([]);
    this.notify.success(`${String(accepted.length)} link(s) added.`);
  }

  /** Hide the suggestion progress dialog. */
  protected closeSuggest(): void {
    this.suggestId.set(null);
  }

  /**
   * Ask the AI for suggestions in the background, one candidate at a time.
   *
   * @param targets - Candidate files.
   */
  private suggest(targets: readonly string[]): void {
    if (targets.length === 0) {
      return;
    }
    const source = this.path();
    const operation = this.jobs.track(
      'link-suggest',
      `Suggest links for ${fileNameOf(source)} among ${String(targets.length)} file(s)`,
      async (progress) => {
        progress.setTotal(targets.length);
        const suggestions: LinkSuggestion[] = [];
        try {
          for (const target of targets) {
            this.suggestCurrent.set(fileNameOf(target));
            suggestions.push(...(await this.details.suggestLinks(source, [target])));
            progress.step(`${String(suggestions.length)} suggestion(s)`);
          }
        } finally {
          this.suggestCurrent.set(null);
          this.showSuggestions(suggestions);
        }
        return `${String(suggestions.length)} suggestion(s) for ${String(targets.length)} file(s). Review them under "AI suggestions".`;
      },
    );
    this.suggestId.set(operation.id);
  }

  /**
   * Put suggestions up for review, preselecting strong ones.
   *
   * @param suggestions - AI suggestions.
   */
  private showSuggestions(suggestions: readonly LinkSuggestion[]): void {
    this.review.set(
      suggestions.map((suggestion) => ({
        suggestion,
        accepted: suggestion.force >= SUGGESTION_PRESELECT,
      })),
    );
  }

  /**
   * Explore links (one level, or breadth-first up to a file cap).
   *
   * @param path - Center file.
   * @param links - Links of the center.
   * @param full - Walk the whole connected component.
   * @returns Graph data.
   */
  private async explore(
    path: string,
    links: readonly FileLink[],
    full: boolean,
  ): Promise<ReturnType<typeof buildLinkGraph>> {
    const byFile = new Map<string, readonly FileLink[]>([[path, links]]);
    const queue = full ? links.map((link) => link.other) : [];
    while (queue.length > 0 && byFile.size < MAX_TREE_FILES) {
      const next = queue.shift();
      if (next === undefined || byFile.has(next)) {
        continue;
      }
      const nextLinks = await this.details.links(next);
      byFile.set(next, nextLinks);
      queue.push(...nextLinks.map((link) => link.other).filter((other) => !byFile.has(other)));
    }
    return buildLinkGraph(path, byFile);
  }
}
