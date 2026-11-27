import { inject, Injectable, signal } from '@angular/core';
import { toApiProblem } from '../../core/api/api-error';
import { ApiClient, backendUrl } from '../../core/api/api-client';
import { parseRemoteCatalog, type RemoteCatalog } from './ai-routing';
import { isCustomProvider } from './custom-providers';

const MODELS_URL = backendUrl('/ai/models');
const CUSTOM_MODELS_URL = backendUrl('/ai/models?scope=custom');

/**
 * Catalog with the custom provider lists replaced.
 *
 * @param catalog - Current lists.
 * @param custom - Fresh lists of the custom providers.
 * @returns Built-in lists kept, custom ones replaced (deleted providers dropped).
 */
export function withCustomLists(catalog: RemoteCatalog, custom: RemoteCatalog): RemoteCatalog {
  const builtIn = Object.entries(catalog).filter(([provider]) => !isCustomProvider(provider));
  return { ...Object.fromEntries(builtIn), ...custom };
}

/**
 * Live model lists of the providers (kept for the session).
 *
 * Built-in providers are asked only on "Reload models"; custom ones, which have no built-in
 * list, are also asked when shown without a list or after being edited.
 */
@Injectable({ providedIn: 'root' })
export class ModelCatalogStore {
  private readonly api = inject(ApiClient);

  /** Live lists per provider value, empty until the first reload. */
  readonly catalog = signal<RemoteCatalog>({});
  readonly loading = signal(false);
  /** Failure of the last load. */
  readonly error = signal<string | null>(null);
  /** Incremented on each reload (installed Ollama models reload with it). */
  readonly reloads = signal(0);
  /** Providers already asked for automatically (a failure is not retried in a loop). */
  private readonly requested = new Set<string>();

  /**
   * Load the lists once for providers that have none yet.
   *
   * @param providers - Provider values.
   */
  async ensureListed(providers: readonly string[]): Promise<void> {
    const missing = providers.filter((id) => !(id in this.catalog()) && !this.requested.has(id));
    if (missing.length === 0) {
      return;
    }
    missing.forEach((id) => this.requested.add(id));
    await this.reloadCustom();
  }

  /** Ask every provider for its models with the stored API keys. */
  async reload(): Promise<void> {
    this.reloads.update((count) => count + 1);
    await this.load(MODELS_URL, (_, fresh) => fresh);
  }

  /** Ask only the custom providers for their models (built-in lists kept). */
  async reloadCustom(): Promise<void> {
    await this.load(CUSTOM_MODELS_URL, withCustomLists);
  }

  /**
   * Fetch model lists and merge them into the catalog.
   *
   * @param url - Model list route.
   * @param merge - New catalog from the current one and the fetched lists.
   */
  private async load(
    url: string,
    merge: (current: RemoteCatalog, fresh: RemoteCatalog) => RemoteCatalog,
  ): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const fresh = parseRemoteCatalog(await this.api.get<unknown>(url, { silent: true }));
      this.catalog.update((current) => merge(current, fresh));
    } catch (error) {
      this.error.set(toApiProblem(error).message);
    } finally {
      this.loading.set(false);
    }
  }
}
