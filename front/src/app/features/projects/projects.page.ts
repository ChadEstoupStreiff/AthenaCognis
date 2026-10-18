import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  resource,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { CatalogStore } from '../../core/catalog/catalog.store';
import { DashboardApi } from '../../core/dashboard/dashboard.api';
import { EmptyStateComponent } from '../../shared/ui/empty-state.component';
import { PageHeaderComponent } from '../../shared/ui/page-header.component';
import { ProjectDialogComponent } from './project-dialog.component';
import { MarkdownViewComponent } from '../../shared/ui/markdown-view.component';

/** Every project as cards. */
@Component({
  selector: 'ac-projects-page',
  imports: [
    RouterLink,
    ButtonModule,
    EmptyStateComponent,
    PageHeaderComponent,
    ProjectDialogComponent,
    MarkdownViewComponent,
  ],
  template: `
    <ac-page-header title="Projects" [subtitle]="catalog.projectList().length + ' projects'">
      <p-button label="New project" icon="pi pi-plus" size="small" (onClick)="creating.set(true)" />
    </ac-page-header>
    <div class="grid">
      @for (project of catalog.projectList(); track project.name) {
        <a
          class="card ac-panel"
          [routerLink]="['/projects', project.name]"
          [style.--color]="catalog.projectColor(project.name)"
        >
          <span class="stripe"></span>
          <strong>{{ project.name }}</strong>
          @if (project.description) {
            <ac-markdown-view class="ac-muted" [source]="project.description" layout="compact" />
          } @else {
            <p class="ac-muted">No description</p>
          }
          <span class="meta ac-muted">
            <i class="pi pi-file"></i>{{ fileCounts().get(project.name) ?? 0 }} files
            @if (openTodos(project.todo) > 0) {
              <i class="pi pi-check-square"></i>{{ openTodos(project.todo) }} to do
            }
          </span>
        </a>
      } @empty {
        <div class="ac-panel"><ac-empty-state icon="pi pi-briefcase" title="No projects" /></div>
      }
    </div>
    <ac-project-dialog [(visible)]="creating" (saved)="open($event)" />
  `,
  styles: `
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: 14px;
    }
    .card {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 18px 16px 14px;
      overflow: hidden;
      color: inherit;
      text-decoration: none;
    }
    .card:hover {
      border-color: var(--color);
    }
    .stripe {
      position: absolute;
      inset: 0 0 auto;
      height: 4px;
      background: var(--color);
    }
    p {
      margin: 0;
      font-size: 13px;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .meta {
      display: flex;
      gap: 6px;
      align-items: center;
      font-size: 12px;
      margin-top: auto;
    }
    .meta i {
      font-size: 11px;
      margin-left: 4px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectsPage {
  protected readonly catalog = inject(CatalogStore);
  private readonly dashboard = inject(DashboardApi);
  private readonly router = inject(Router);

  protected readonly creating = signal(false);
  private readonly metrics = resource({ loader: () => this.dashboard.metrics(false) });
  protected readonly fileCounts = computed(
    () =>
      new Map(
        (this.metrics.value()?.filesPerProject ?? []).map((entry) => [entry.name, entry.count]),
      ),
  );

  /**
   * Count unfinished TODO items.
   *
   * @param todo - TODO list.
   * @returns Open items.
   */
  protected openTodos(todo: readonly { done: boolean }[]): number {
    return todo.filter((item) => !item.done).length;
  }

  /**
   * Open a project.
   *
   * @param name - Project name.
   */
  protected open(name: string): void {
    void this.router.navigate(['/projects', name]);
  }
}
