import { inject, Injectable, signal } from '@angular/core';
import { toApiProblem } from '../../core/api/api-error';
import { ApiClient, backendUrl } from '../../core/api/api-client';
import { parseRemoteCatalog, type RemoteCatalog } from './ai-routing';

const MODELS_URL = backendUrl('/ai/models');

/** Live model lists of the providers, loaded only on "Reload models" (kept for the session). */
@Injectable({ providedIn: 'root' })
export class ModelCatalogStore {
  private readonly api = inject(ApiClient);

  /** Live lists per provider value, empty until the first reload. */
  readonly catalog = signal<RemoteCatalog>({});
  readonly loading = signal(false);
  /** Failure of the last reload. */
  readonly error = signal<string | null>(null);
  /** Incremented on each reload (installed Ollama models reload with it). */
  readonly reloads = signal(0);

  /** Ask every provider for its models with the stored API keys. */
  async reload(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    this.reloads.update((count) => count + 1);
    try {
      this.catalog.set(
        parseRemoteCatalog(await this.api.get<unknown>(MODELS_URL, { silent: true })),
      );
    } catch (error) {
      this.error.set(toApiProblem(error).message);
    } finally {
      this.loading.set(false);
    }
  }
}
