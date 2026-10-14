import { ChangeDetectionStrategy, Component, computed, inject, model, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { DialogModule } from 'primeng/dialog';
import { displayTitle, INFO_TEXT_FIELDS, type InfoTextField, type PaperInfo } from '@domain/sota';
import { NotifyService } from '../../core/notify/notify.service';
import { type ReviewItem, ResearchStore } from './research.store';

/** One changed field. */
interface FieldChange {
  readonly field: InfoTextField;
  readonly before: string;
  readonly after: string;
  readonly origin: string;
}

const LABELS: Readonly<Record<InfoTextField, string>> = {
  title: 'Title',
  authors: 'Authors',
  year: 'Year',
  journal: 'Journal',
  url: 'URL',
  doi: 'DOI',
  volume: 'Volume',
  issue: 'Issue',
  pages: 'Pages',
  source: 'Source',
};

/**
 * Fields a lookup changes, with where each value came from.
 *
 * @param item - Review item.
 * @returns Changes.
 */
export function changesOf(item: ReviewItem): FieldChange[] {
  const { paper, result } = item;
  return INFO_TEXT_FIELDS.filter(
    (field) => field !== 'source' && result.info[field] !== paper.info[field],
  ).map((field) => ({
    field,
    before: paper.info[field],
    after: result.info[field],
    origin:
      result.online !== null && result.online[field] === result.info[field]
        ? result.online.source
        : 'grobid',
  }));
}

/** Review metadata found online, field by field, before saving. */
@Component({
  selector: 'ac-review-dialog',
  imports: [FormsModule, ButtonModule, CheckboxModule, DialogModule],
  templateUrl: './review-dialog.component.html',
  styleUrl: './research-dialogs.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReviewDialogComponent {
  private readonly notify = inject(NotifyService);
  protected readonly store = inject(ResearchStore);

  /** Visibility (two-way). */
  readonly visible = model(false);

  protected readonly current = computed(() => this.store.review()[0] ?? null);
  protected readonly changes = computed(() => {
    const item = this.current();
    return item === null ? [] : changesOf(item);
  });
  /** Fields the user unticked for the current item. */
  protected readonly rejected = signal<ReadonlySet<InfoTextField>>(new Set());
  protected readonly labels = LABELS;
  protected readonly title = displayTitle;

  /**
   * Toggle a field.
   *
   * @param field - Field.
   */
  protected toggle(field: InfoTextField): void {
    this.rejected.update((current) => {
      const next = new Set(current);
      if (!next.delete(field)) {
        next.add(field);
      }
      return next;
    });
  }

  /** Save the ticked fields of the current item. */
  protected async accept(): Promise<void> {
    const item = this.current();
    if (item === null) {
      return;
    }
    await this.store.save(new Map([[item.paper.path, this.merged(item)]]));
    this.next();
  }

  /** Save every remaining item with all its fields. */
  protected async acceptAll(): Promise<void> {
    const queue = this.store.review();
    const saved = await this.store.save(
      new Map(queue.map((item) => [item.paper.path, item.result.info])),
    );
    this.store.review.set([]);
    this.rejected.set(new Set());
    this.notify.success(`${String(saved)} reference(s) saved.`);
    this.visible.set(false);
  }

  /** Skip the current item. */
  protected next(): void {
    const item = this.current();
    if (item !== null) {
      this.store.dismiss(item.paper.path);
    }
    this.rejected.set(new Set());
    if (this.store.review().length === 0) {
      this.visible.set(false);
    }
  }

  /**
   * Current metadata with the ticked fields applied (not validated).
   *
   * @param item - Review item.
   * @returns Metadata.
   */
  private merged(item: ReviewItem): PaperInfo {
    const info: Record<string, string | boolean> = {
      ...item.paper.info,
      source: item.result.info.source,
      validated: false,
    };
    for (const change of changesOf(item).filter(
      (candidate) => !this.rejected().has(candidate.field),
    )) {
      info[change.field] = change.after;
    }
    return info as unknown as PaperInfo;
  }
}
