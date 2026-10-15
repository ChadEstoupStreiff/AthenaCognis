import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import type { MenuItem } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { MenuModule } from 'primeng/menu';
import { TooltipModule } from 'primeng/tooltip';
import { DropOverlayComponent } from '../../features/capture/drop-overlay.component';
import { UploadDialogComponent } from '../../features/capture/upload-dialog.component';
import { VoiceDockComponent } from '../../features/capture/voice-dock.component';
import { FilePeekComponent } from '../../features/viewer/file-peek.component';
import { CaptureService } from '../capture/capture.service';
import { fileKindOf, fileNameOf, FILE_KIND_ICONS } from '@domain/files';
import { viewerCommands } from '../../shared/files/file-row';
import { LastOpenedService } from '../files/last-opened.service';
import { PeekService } from '../files/peek.service';
import { ShortcutService } from '../shortcuts/shortcut.service';
import { TelemetryConsentComponent } from '../telemetry/telemetry-consent.component';
import { TelemetryService } from '../telemetry/telemetry.service';
import { ThemeService } from '../theme/theme.service';
import { CommandPaletteComponent } from './command-palette.component';
import { JobsIndicatorComponent } from './jobs-indicator.component';
import { MAIN_NAV, SETTINGS_NAV } from './nav-items';
import { PaletteService } from './palette.service';

const THEME_ICONS = { light: 'pi pi-sun', dark: 'pi pi-moon', system: 'pi pi-desktop' } as const;

/** Application frame: navigation rail, top bar and routed content. */
@Component({
  selector: 'ac-shell',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    ButtonModule,
    MenuModule,
    TooltipModule,
    CommandPaletteComponent,
    JobsIndicatorComponent,
    UploadDialogComponent,
    DropOverlayComponent,
    VoiceDockComponent,
    FilePeekComponent,
    TelemetryConsentComponent,
  ],
  templateUrl: './shell.component.html',
  styleUrl: './shell.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShellComponent {
  private readonly router = inject(Router);
  protected readonly theme = inject(ThemeService);
  protected readonly palette = inject(PaletteService);
  protected readonly capture = inject(CaptureService);
  protected readonly peek = inject(PeekService);
  private readonly lastOpened = inject(LastOpenedService);
  protected readonly telemetry = inject(TelemetryService);

  protected readonly mainNav = MAIN_NAV;
  protected readonly settingsNav = SETTINGS_NAV;
  protected readonly collapsed = signal(false);
  protected readonly themeIcon = computed(() => THEME_ICONS[this.theme.mode()]);
  protected readonly lastFile = computed(() => {
    const path = this.lastOpened.path();
    return path === null
      ? null
      : {
          name: fileNameOf(path),
          icon: FILE_KIND_ICONS[fileKindOf(path)],
          commands: viewerCommands(path),
        };
  });
  protected readonly isMac = /Mac|iPhone|iPad/.test(navigator.userAgent);
  protected readonly newItems: MenuItem[] = [
    {
      label: 'Note',
      icon: 'pi pi-pen-to-square',
      command: (): void => void this.router.navigate(['/notes'], { queryParams: { create: '1' } }),
    },
    {
      label: 'Upload files',
      icon: 'pi pi-cloud-upload',
      command: (): void => {
        this.capture.openUpload();
      },
    },
    {
      label: 'Voice memo',
      icon: 'pi pi-microphone',
      command: (): void => {
        this.capture.openVoice();
      },
    },
    { separator: true },
    {
      label: 'Time entry',
      icon: 'pi pi-clock',
      command: (): void => void this.router.navigate(['/time'], { queryParams: { log: '1' } }),
    },
    {
      label: 'Task',
      icon: 'pi pi-check-square',
      command: (): void => void this.router.navigate(['/work'], { queryParams: { newTask: '1' } }),
    },
    {
      label: 'Contact',
      icon: 'pi pi-user-plus',
      command: (): void => void this.router.navigate(['/people'], { queryParams: { new: '1' } }),
    },
  ];

  /** Install keyboard shortcuts and send the daily telemetry ping when allowed. */
  constructor() {
    inject(ShortcutService).install();
    effect(() => {
      if (this.telemetry.consent() === true) {
        void this.telemetry.pingIfDue();
      }
    });
  }

  /** Collapse or expand the navigation rail. */
  protected toggleRail(): void {
    this.collapsed.update((value) => !value);
  }
}
