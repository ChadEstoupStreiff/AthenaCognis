import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ConfirmationService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { ColorPickerModule } from 'primeng/colorpicker';
import { InputTextModule } from 'primeng/inputtext';
import type { Tag } from '@domain/contracts';
import { colorForName, normalizeHexColor } from '@domain/color';
import { CatalogStore } from '../../../core/catalog/catalog.store';
import { ProjectsApi } from '../../../core/projects/projects.api';

/** Create, rename, recolor and delete tags (projects are managed on the Projects page). */
@Component({
  selector: 'ac-tags-section',
  imports: [FormsModule, RouterLink, ButtonModule, ColorPickerModule, InputTextModule],
  template: `
    <section class="group" id="tags">
      <h2>Tags</h2>
      <p class="ac-muted intro">
        Projects are managed on the <a routerLink="/projects">Projects</a> page.
      </p>
      <form class="inline toolbar" (ngSubmit)="create()">
        <p-colorpicker name="color" [(ngModel)]="newColor" format="hex" appendTo="body" />
        <input
          pInputText
          name="name"
          placeholder="New tag"
          [(ngModel)]="newName"
          aria-label="New tag name"
        />
        <p-button
          type="submit"
          label="Add"
          icon="pi pi-plus"
          size="small"
          [disabled]="newName.trim() === ''"
        />
      </form>
      <div class="tag-list">
        @for (tag of catalog.tagList(); track tag.name) {
          <div class="tag-row">
            <p-colorpicker
              [ngModel]="color(tag)"
              (ngModelChange)="recolor(tag, $event)"
              format="hex"
              appendTo="body"
            />
            @if (renaming() === tag.name) {
              <form class="inline grow" (ngSubmit)="rename(tag, draft)">
                <input pInputText name="rename" [(ngModel)]="draft" aria-label="Tag name" />
                <p-button
                  type="submit"
                  icon="pi pi-check"
                  size="small"
                  [text]="true"
                  ariaLabel="Save name"
                />
                <p-button
                  icon="pi pi-times"
                  size="small"
                  [text]="true"
                  severity="secondary"
                  ariaLabel="Cancel"
                  (onClick)="renaming.set(null)"
                />
              </form>
            } @else {
              <a class="grow" [routerLink]="['/library']" [queryParams]="{ tags: tag.name }">{{
                tag.name
              }}</a>
              <p-button
                icon="pi pi-pencil"
                size="small"
                [text]="true"
                severity="secondary"
                ariaLabel="Rename"
                (onClick)="startRename(tag)"
              />
              <p-button
                icon="pi pi-trash"
                size="small"
                [text]="true"
                severity="danger"
                ariaLabel="Delete"
                (onClick)="remove(tag)"
              />
            }
          </div>
        } @empty {
          <p class="ac-muted">No tag yet.</p>
        }
      </div>
    </section>
  `,
  styleUrl: './section.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TagsSectionComponent {
  private readonly projects = inject(ProjectsApi);
  private readonly confirm = inject(ConfirmationService);
  protected readonly catalog = inject(CatalogStore);

  protected newName = '';
  protected newColor = '#7700a7';
  protected draft = '';
  protected readonly renaming = signal<string | null>(null);

  /**
   * Hex color of a tag.
   *
   * @param tag - Tag.
   * @returns Color.
   */
  protected color(tag: Tag): string {
    return normalizeHexColor(tag.color) ?? colorForName(tag.name);
  }

  /** Create the new tag. */
  protected async create(): Promise<void> {
    const name = this.newName.trim();
    if (name === '') {
      return;
    }
    await this.projects.createTag({ name, color: this.newColor });
    this.newName = '';
  }

  /**
   * Start renaming.
   *
   * @param tag - Tag.
   */
  protected startRename(tag: Tag): void {
    this.draft = tag.name;
    this.renaming.set(tag.name);
  }

  /**
   * Rename a tag.
   *
   * @param tag - Tag.
   * @param name - New name.
   */
  protected async rename(tag: Tag, name: string): Promise<void> {
    if (name.trim() !== '' && name.trim() !== tag.name) {
      await this.projects.updateTag(tag.name, { name: name.trim(), color: this.color(tag) });
    }
    this.renaming.set(null);
  }

  /**
   * Change a tag color.
   *
   * @param tag - Tag.
   * @param color - New color.
   */
  protected async recolor(tag: Tag, color: string): Promise<void> {
    await this.projects.updateTag(tag.name, { name: tag.name, color });
  }

  /**
   * Confirm and delete a tag.
   *
   * @param tag - Tag.
   */
  protected remove(tag: Tag): void {
    this.confirm.confirm({
      header: 'Delete tag',
      message: `Delete “${tag.name}”? Files keep existing, only the tag is removed.`,
      acceptButtonProps: { label: 'Delete', severity: 'danger' },
      rejectButtonProps: { label: 'Cancel', severity: 'secondary', text: true },
      accept: () => void this.projects.deleteTag(tag.name),
    });
  }
}
