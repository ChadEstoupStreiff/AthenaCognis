import { ChangeDetectionStrategy, Component, inject, resource, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { PasswordModule } from 'primeng/password';
import { TagModule } from 'primeng/tag';
import { ApiClient, backendUrl } from '../../../core/api/api-client';
import { JobsStore } from '../../../core/jobs/jobs.store';
import { DataSync } from '../../../core/state/data-sync.service';
import { BytesPipe } from '../../../shared/pipes/bytes.pipe';
import { API_KEYS } from '../ai-routing';
import { checkApiKey, type KeyCheck } from '../key-check';
import { SettingsSection } from './settings-section';

/** Installed Ollama model. */
interface OllamaModel {
  readonly name: string;
  readonly size?: number;
  readonly modified_at?: string;
}

/** Cloud API keys and the Ollama server. */
@Component({
  selector: 'ac-providers-section',
  imports: [FormsModule, ButtonModule, InputTextModule, PasswordModule, TagModule, BytesPipe],
  templateUrl: './providers.section.html',
  styleUrl: './section.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProvidersSectionComponent extends SettingsSection {
  private readonly api = inject(ApiClient);
  private readonly jobs = inject(JobsStore);
  private readonly sync = inject(DataSync);

  protected readonly keys = API_KEYS;
  protected readonly checks = signal<Readonly<Record<string, KeyCheck | 'checking'>>>({});
  protected readonly pullName = signal('');

  protected readonly ollamaStatus = resource({
    params: () => ({ url: this.text('ollama_server'), version: this.sync.version('ollama')() }),
    loader: async () => {
      try {
        return await this.api.get<boolean>(backendUrl('/ollama/test_url'), { silent: true });
      } catch {
        return false;
      }
    },
  });
  protected readonly installed = resource({
    params: () => ({ url: this.text('ollama_server'), version: this.sync.version('ollama')() }),
    loader: () => this.api.get<OllamaModel[]>(backendUrl('/ollama/list'), { silent: true }),
  });

  /**
   * Check a key against its provider.
   *
   * @param setting - Key setting.
   */
  protected async check(setting: string): Promise<void> {
    this.checks.update((current) => ({ ...current, [setting]: 'checking' }));
    const result = await checkApiKey(setting, this.text(setting));
    this.checks.update((current) => ({ ...current, [setting]: result }));
  }

  /**
   * Save the Ollama URL.
   *
   * @param url - Server URL.
   */
  protected setOllamaUrl(url: string): void {
    this.save('ollama_server', url.trim());
  }

  /** Pull a model in the background (the backend blocks until the download ends). */
  protected pull(): void {
    const name = this.pullName().trim();
    if (name === '') {
      return;
    }
    this.pullName.set('');
    this.jobs.track('ollama-pull', `Install ${name}`, async () => {
      await this.api.post(backendUrl(`/ollama/pull/${encodeURIComponent(name)}`), undefined, {
        silent: true,
      });
      this.sync.invalidate('ollama');
      return `${name} installed.`;
    });
  }
}
