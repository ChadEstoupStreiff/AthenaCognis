import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { PasswordModule } from 'primeng/password';
import { TagModule } from 'primeng/tag';
import { NotifyService } from '../../../core/notify/notify.service';
import { SettingsStore } from '../../../core/settings/settings.store';
import { modelCount } from '../ai-routing';
import {
  CUSTOM_PROVIDERS_KEY,
  type CustomProvider,
  type CustomProviderDraft,
  draftError,
  draftOf,
  EMPTY_DRAFT,
  newProviderId,
  parseCustomProviders,
  upsertProvider,
} from '../custom-providers';
import { ModelCatalogStore } from '../model-catalog.store';

/** User-defined OpenAI-compatible providers: list, add, edit and delete. */
@Component({
  selector: 'ac-custom-providers',
  imports: [FormsModule, ButtonModule, InputTextModule, PasswordModule, TagModule],
  template: `
    @for (provider of providers(); track provider.id) {
      <div class="row">
        <div class="label">
          <strong>{{ provider.name }}</strong
          ><small class="ac-muted">{{ provider.base_url }}</small>
        </div>
        <div class="inline">
          @if (models.catalog()[provider.id]; as live) {
            @if (live.error === null) {
              <p-tag severity="info" [value]="modelCount(live) + ' models'" icon="pi pi-list" />
            } @else {
              <p-tag severity="warn" [value]="live.error" />
            }
          }
          <p-button
            label="Edit"
            size="small"
            severity="secondary"
            [outlined]="true"
            (onClick)="edit(provider)"
          />
          <p-button
            [label]="removingId() === provider.id ? 'Confirm delete' : 'Delete'"
            size="small"
            severity="danger"
            [outlined]="true"
            (onClick)="remove(provider.id)"
          />
        </div>
      </div>
    }
    @if (draft(); as form) {
      <form class="row stacked" (ngSubmit)="submit()">
        <input
          pInputText
          name="name"
          placeholder="Name (e.g. Albert)"
          [ngModel]="form.name"
          (ngModelChange)="change({ name: $event })"
          aria-label="Provider name"
        />
        <input
          pInputText
          name="base_url"
          placeholder="Base URL of an OpenAI-compatible API (https://…/v1)"
          [ngModel]="form.base_url"
          (ngModelChange)="change({ base_url: $event })"
          aria-label="Provider base URL"
        />
        <p-password
          name="api_key"
          placeholder="API key"
          [ngModel]="form.api_key"
          (ngModelChange)="change({ api_key: $event })"
          [feedback]="false"
          [toggleMask]="true"
          [fluid]="true"
          autocomplete="off"
          ariaLabel="Provider API key"
        />
        <input
          pInputText
          name="context_tokens"
          inputmode="numeric"
          placeholder="Context size in tokens (optional, read from the provider when empty)"
          [ngModel]="form.context_tokens"
          (ngModelChange)="change({ context_tokens: $event })"
          aria-label="Provider context size in tokens"
        />
        @if (problem(); as message) {
          <small class="ac-muted">{{ message }}</small>
        }
        <div class="inline">
          <p-button type="submit" label="Save" size="small" [disabled]="problem() !== null" />
          <p-button label="Cancel" size="small" severity="secondary" (onClick)="close()" />
        </div>
      </form>
    } @else {
      <div class="row">
        <p-button
          label="Add provider"
          icon="pi pi-plus"
          size="small"
          severity="secondary"
          [outlined]="true"
          [disabled]="!settings.snapshot.hasValue()"
          (onClick)="add()"
        />
      </div>
    }
  `,
  styleUrl: './section.scss',
  host: { style: 'display: block' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CustomProvidersComponent {
  protected readonly settings = inject(SettingsStore);
  protected readonly models = inject(ModelCatalogStore);
  private readonly notify = inject(NotifyService);
  protected readonly modelCount = modelCount;

  protected readonly providers = computed(() =>
    parseCustomProviders(this.settings.values()[CUSTOM_PROVIDERS_KEY]),
  );
  protected readonly draft = signal<CustomProviderDraft | null>(null);
  protected readonly problem = computed(() => {
    const draft = this.draft();
    return draft === null ? null : draftError(draft);
  });
  /** Provider being edited, null when adding one. */
  private readonly editedId = signal<string | null>(null);
  /** Provider waiting for a second click on delete. */
  protected readonly removingId = signal<string | null>(null);

  /** Open an empty form. */
  protected add(): void {
    this.editedId.set(null);
    this.draft.set(EMPTY_DRAFT);
  }

  /**
   * Open the form on a provider.
   *
   * @param provider - Provider.
   */
  protected edit(provider: CustomProvider): void {
    this.editedId.set(provider.id);
    this.draft.set(draftOf(provider));
  }

  /**
   * Update typed fields.
   *
   * @param fields - Changed fields.
   */
  protected change(fields: Partial<CustomProviderDraft>): void {
    this.draft.update((draft) => (draft === null ? null : { ...draft, ...fields }));
  }

  /** Close the form. */
  protected close(): void {
    this.draft.set(null);
  }

  /** Save the form. */
  protected async submit(): Promise<void> {
    const draft = this.draft();
    if (draft === null || draftError(draft) !== null) {
      return;
    }
    const id = this.editedId() ?? newProviderId(draft.name, Date.now());
    if (await this.store(upsertProvider(this.providers(), id, draft))) {
      this.close();
    }
  }

  /**
   * Delete a provider on the second click.
   *
   * @param id - Provider identifier.
   */
  protected async remove(id: string): Promise<void> {
    if (this.removingId() !== id) {
      this.removingId.set(id);
      return;
    }
    this.removingId.set(null);
    await this.store(this.providers().filter((provider) => provider.id !== id));
  }

  /**
   * Write the list, then reload the model lists of the custom providers.
   *
   * @param providers - Providers.
   * @returns True when saved.
   */
  private async store(providers: readonly CustomProvider[]): Promise<boolean> {
    try {
      await this.settings.set(CUSTOM_PROVIDERS_KEY, providers);
    } catch {
      this.notify.error('Could not save the providers.');
      return false;
    }
    void this.models.reloadCustom();
    return true;
  }
}
