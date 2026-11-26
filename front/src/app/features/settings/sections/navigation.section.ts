import { type CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import {
  MAIN_NAV,
  NAV_HIDDEN_KEY,
  NAV_ORDER_KEY,
  type NavItem,
  orderNav,
} from '../../../core/layout/nav-items';
import { SettingsStore } from '../../../core/settings/settings.store';
import { SettingsSection } from './settings-section';

/** Sidebar tabs: order and visibility. */
@Component({
  selector: 'ac-navigation-section',
  imports: [DragDropModule, FormsModule, ButtonModule, ToggleSwitchModule],
  template: `
    <section class="group" id="navigation">
      <div class="heading">
        <h2>Sidebar</h2>
        <p-button
          label="Reset"
          icon="pi pi-replay"
          size="small"
          [text]="true"
          severity="secondary"
          [disabled]="isDefault()"
          (onClick)="reset()"
        />
      </div>
      <p class="intro ac-muted">
        Drag to reorder tabs. Hidden tabs only leave the sidebar: their pages stay reachable with
        search (⌘K / Ctrl K) and <kbd>g</kbd> shortcuts.
      </p>
      <div class="nav-list" cdkDropList (cdkDropListDropped)="reorder($event)">
        @for (item of items(); track item.route) {
          <div class="nav-row" cdkDrag [class.off]="hidden().includes(item.route)">
            <i class="pi pi-bars handle" cdkDragHandle aria-hidden="true"></i>
            <i [class]="item.icon" aria-hidden="true"></i>
            <span class="grow">{{ item.label }}</span>
            <kbd class="ac-muted">g {{ item.shortcut }}</kbd>
            <p-toggleswitch
              [ngModel]="!hidden().includes(item.route)"
              (ngModelChange)="setShown(item.route, $event)"
              [ariaLabel]="'Show ' + item.label + ' in sidebar'"
            />
          </div>
        }
      </div>
    </section>
  `,
  styleUrls: ['./section.scss', './navigation.section.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NavigationSectionComponent extends SettingsSection {
  private readonly settings = inject(SettingsStore);

  /** Tabs in rail order; set locally on change so the list does not jump back while saving. */
  protected readonly items = linkedSignal<readonly NavItem[]>(() =>
    orderNav(MAIN_NAV, this.settings.list(NAV_ORDER_KEY)),
  );
  /** Hidden routes, updated locally like {@link items}. */
  protected readonly hidden = linkedSignal<readonly string[]>(() =>
    this.settings.list(NAV_HIDDEN_KEY),
  );
  protected readonly isDefault = computed(
    () =>
      this.hidden().length === 0 &&
      this.items().every((item, index) => item.route === MAIN_NAV[index]?.route),
  );

  /**
   * Move a tab after a drag.
   *
   * @param event - Drop event.
   */
  protected reorder(event: CdkDragDrop<unknown>): void {
    const next = [...this.items()];
    moveItemInArray(next, event.previousIndex, event.currentIndex);
    this.items.set(next);
    this.save(
      NAV_ORDER_KEY,
      next.map((item) => item.route),
      true,
    );
  }

  /**
   * Show or hide a tab in the sidebar.
   *
   * @param route - Tab route.
   * @param shown - Whether the tab is shown.
   */
  protected setShown(route: string, shown: boolean): void {
    const others = this.hidden().filter((hiddenRoute) => hiddenRoute !== route);
    const next = shown ? others : [...others, route];
    this.hidden.set(next);
    this.save(NAV_HIDDEN_KEY, next, true);
  }

  /** Restore default order and show every tab. */
  protected reset(): void {
    this.items.set(MAIN_NAV);
    this.hidden.set([]);
    this.save(NAV_ORDER_KEY, [], true);
    this.save(NAV_HIDDEN_KEY, [], true);
  }
}
