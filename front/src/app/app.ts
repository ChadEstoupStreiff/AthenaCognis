import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ToastModule } from 'primeng/toast';
import { AppearanceService } from './core/theme/appearance.service';
import { ThemeService } from './core/theme/theme.service';

/** Root component: router outlet plus global toast and confirm dialog hosts. */
@Component({
  selector: 'ac-root',
  imports: [RouterOutlet, ToastModule, ConfirmDialogModule],
  template: `
    <router-outlet />
    <p-toast position="bottom-right" />
    <p-confirmdialog />
  `,
  styles: `
    :host {
      display: block;
      height: 100%;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  /** Instantiated eagerly so the theme class is applied before the first route renders. */
  protected readonly theme = inject(ThemeService);
  /** Instantiated eagerly so custom fonts and colors apply before the first route renders. */
  protected readonly appearance = inject(AppearanceService);
}
