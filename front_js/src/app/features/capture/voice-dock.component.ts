import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { lastValueFrom } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { DatePickerModule } from 'primeng/datepicker';
import { formatFileTime, formatLocalDate } from '@domain/time';
import { toApiProblem } from '../../core/api/api-error';
import { CaptureService } from '../../core/capture/capture.service';
import { FilesApi } from '../../core/files/files.api';
import { NotifyService } from '../../core/notify/notify.service';
import { viewerCommands } from '../../shared/files/file-row';
import { type Recording, recordingUnavailableReason, startRecording } from './voice-recorder';

/** Recorder phases. */
type Phase = 'idle' | 'recording' | 'review' | 'saving';

const AUDIO_FOLDER = 'audio';
const SECONDS_PER_MINUTE = 60;
const TICK_MS = 1_000;
const PAD = 2;

/** Floating voice memo recorder (keeps recording while navigating). */
@Component({
  selector: 'ac-voice-dock',
  imports: [FormsModule, ButtonModule, DatePickerModule],
  templateUrl: './voice-dock.component.html',
  styleUrl: './voice-dock.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VoiceDockComponent {
  protected readonly capture = inject(CaptureService);
  private readonly files = inject(FilesApi);
  private readonly notify = inject(NotifyService);
  private readonly router = inject(Router);
  private recording: Recording | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private audio: Blob | null = null;

  protected readonly phase = signal<Phase>('idle');
  protected readonly seconds = signal(0);
  protected readonly audioUrl = signal<string | null>(null);
  protected readonly date = signal(new Date());
  protected readonly unavailable = recordingUnavailableReason();
  protected readonly elapsed = computed(() => {
    const total = this.seconds();
    return `${String(Math.floor(total / SECONDS_PER_MINUTE))}:${String(total % SECONDS_PER_MINUTE).padStart(PAD, '0')}`;
  });

  /** Release resources on destroy. */
  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.discard();
    });
  }

  /** Start recording. */
  protected async start(): Promise<void> {
    try {
      this.recording = await startRecording();
      this.seconds.set(0);
      this.phase.set('recording');
      this.timer = setInterval(() => {
        this.seconds.update((value) => value + 1);
      }, TICK_MS);
    } catch (error) {
      this.notify.error(
        'Microphone unavailable',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /** Stop and review. */
  protected async stop(): Promise<void> {
    this.clearTimer();
    const blob = await this.recording?.stop();
    this.recording = null;
    if (blob !== undefined) {
      this.audio = blob;
      this.audioUrl.set(URL.createObjectURL(blob));
      this.date.set(new Date());
      this.phase.set('review');
    }
  }

  /** Upload the memo and open it. */
  protected async save(): Promise<void> {
    if (this.audio === null) {
      return;
    }
    this.phase.set('saving');
    const date = formatLocalDate(this.date());
    const name = `audio_${date}_${formatFileTime(new Date())}.wav`;
    try {
      const target = { folder: AUDIO_FOLDER, date, name };
      const last = await lastValueFrom(
        this.files.upload(this.audio, target, { ...this.capture.defaults() }),
      );
      this.files.uploadsFinished();
      this.discard();
      this.capture.voiceOpen.set(false);
      if (last.kind === 'done') {
        await this.router.navigate(viewerCommands(last.result.path));
      }
    } catch (error) {
      this.notify.error('Could not save the memo', toApiProblem(error).message);
      this.phase.set('review');
    }
  }

  /** Throw the recording away. */
  protected discard(): void {
    this.clearTimer();
    this.recording?.cancel();
    this.recording = null;
    this.audio = null;
    const url = this.audioUrl();
    if (url !== null) {
      URL.revokeObjectURL(url);
    }
    this.audioUrl.set(null);
    this.phase.set('idle');
  }

  /** Close the dock (only when not recording). */
  protected close(): void {
    this.discard();
    this.capture.voiceOpen.set(false);
  }

  /** Stop the elapsed-time timer. */
  private clearTimer(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
