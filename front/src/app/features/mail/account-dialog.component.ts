import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  resource,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { MailAccount, MailAccountInput, MailProvider } from '@domain/contracts';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { PasswordModule } from 'primeng/password';
import { ColorPickerModule } from 'primeng/colorpicker';
import { SelectModule } from 'primeng/select';
import { TextareaModule } from 'primeng/textarea';
import { normalizeHexColor } from '@domain/color';
import { toApiProblem } from '../../core/api/api-error';
import { MailApi } from '../../core/mail/mail.api';

const CUSTOM_PROVIDER = 'custom';
const DEFAULT_IMAP_PORT = 993;
const DEFAULT_SMTP_PORT = 465;
const DEFAULT_COLOR = '#3b82f6';
const SIGNATURE_ROWS = 4;

/** Custom server entry of the provider list. */
const CUSTOM_OPTION = { key: CUSTOM_PROVIDER, label: 'Other (IMAP / SMTP)', help_url: null };

/** Blank form of a new account. */
const BLANK: MailAccountInput = {
  label: '',
  protocol: 'imap',
  color: DEFAULT_COLOR,
  signature: '',
  email: '',
  username: '',
  password: '',
  imap_host: '',
  imap_port: DEFAULT_IMAP_PORT,
  smtp_host: '',
  smtp_port: DEFAULT_SMTP_PORT,
};

/**
 * Form state of an account (password always blank: kept unless retyped).
 *
 * @param account - Account or null.
 * @returns Form.
 */
function formOf(account: MailAccount | null): MailAccountInput {
  return account === null ? BLANK : { ...account, password: '' };
}

/** Add or edit an IMAP/SMTP or Exchange account (the backend tests the login before saving). */
@Component({
  selector: 'ac-mail-account-dialog',
  imports: [
    FormsModule,
    ButtonModule,
    DialogModule,
    InputNumberModule,
    InputTextModule,
    PasswordModule,
    SelectModule,
    ColorPickerModule,
    TextareaModule,
  ],
  template: `
    <p-dialog
      [header]="account() ? 'Edit mail account' : 'Connect a mail account'"
      [modal]="true"
      [(visible)]="visible"
      [style]="{ width: 'min(600px, 96vw)' }"
    >
      <form class="grid" (ngSubmit)="save()">
        @if (!account()) {
          <label class="field wide">
            <span>Provider</span>
            <p-select
              [options]="providerOptions()"
              optionLabel="label"
              optionValue="key"
              [ngModel]="providerKey()"
              (ngModelChange)="pickProvider($event)"
              name="provider"
              [fluid]="true"
              appendTo="body"
            />
          </label>
        }
        @if (preset(); as current) {
          <div class="help wide">
            <p><i class="pi pi-info-circle"></i> {{ current.help }}</p>
            @if (current.help_url; as url) {
              <a [href]="url" target="_blank" rel="noopener noreferrer">
                <i class="pi pi-external-link"></i>
                {{
                  current.key === 'gmail' ? 'Create a Gmail app password' : 'Open account security'
                }}
              </a>
            }
          </div>
        }
        <label class="field">
          <span>Email</span>
          <input
            pInputText
            type="email"
            name="email"
            autocomplete="email"
            [ngModel]="form().email"
            (ngModelChange)="patch({ email: $event })"
          />
        </label>
        <div class="field wide">
          <span>Color</span>
          <div class="color-row">
            <p-colorpicker
              name="color"
              format="hex"
              appendTo="body"
              [ngModel]="form().color"
              (ngModelChange)="setColor($event)"
            />
            <input
              pInputText
              name="color-hex"
              class="hex"
              aria-label="Color hex"
              [ngModel]="form().color"
              (ngModelChange)="setColor($event)"
            />
            <span class="ac-muted">Bar shown next to this account's mail</span>
          </div>
        </div>
        <label class="field">
          <span>Display name</span>
          <input
            pInputText
            name="label"
            placeholder="Shown to recipients"
            [ngModel]="form().label"
            (ngModelChange)="patch({ label: $event })"
          />
        </label>
        <label class="field">
          <span>
            @if (isEws()) {
              Login (DOMAIN&#92;user or email)
            } @else {
              Login (leave blank = email)
            }
          </span>
          <input
            pInputText
            name="username"
            autocomplete="username"
            placeholder="name@example.org"
            [ngModel]="form().username"
            (ngModelChange)="patch({ username: $event })"
          />
        </label>
        <label class="field">
          <span>{{ account() ? 'Password (blank = unchanged)' : 'Password / app password' }}</span>
          <p-password
            name="password"
            [feedback]="false"
            [toggleMask]="true"
            [fluid]="true"
            autocomplete="current-password"
            [ngModel]="form().password"
            (ngModelChange)="patch({ password: $event })"
          />
        </label>
        @if (showServers() && isEws()) {
          <label class="field wide">
            <span>Exchange server or EWS URL</span>
            <input
              pInputText
              name="imap_host"
              placeholder="mail.company.com or https://mail.company.com/EWS/Exchange.asmx"
              [ngModel]="form().imap_host"
              (ngModelChange)="patch({ imap_host: $event })"
            />
          </label>
        } @else if (showServers()) {
          <label class="field">
            <span>IMAP host</span>
            <input
              pInputText
              name="imap_host"
              [ngModel]="form().imap_host"
              (ngModelChange)="patch({ imap_host: $event })"
            />
          </label>
          <label class="field">
            <span>IMAP port</span>
            <p-inputnumber
              name="imap_port"
              [useGrouping]="false"
              [fluid]="true"
              [ngModel]="form().imap_port"
              (ngModelChange)="patch({ imap_port: $event })"
            />
          </label>
          <label class="field">
            <span>SMTP host</span>
            <input
              pInputText
              name="smtp_host"
              [ngModel]="form().smtp_host"
              (ngModelChange)="patch({ smtp_host: $event })"
            />
          </label>
          <label class="field">
            <span>SMTP port (465 SSL, 587 STARTTLS)</span>
            <p-inputnumber
              name="smtp_port"
              [useGrouping]="false"
              [fluid]="true"
              [ngModel]="form().smtp_port"
              (ngModelChange)="patch({ smtp_port: $event })"
            />
          </label>
        } @else {
          <button type="button" class="link wide" (click)="serversOpen.set(true)">
            Server settings: {{ form().imap_host }} · {{ form().smtp_host }}
          </button>
        }
        <label class="field wide">
          <span>Signature (added below new messages and replies)</span>
          <textarea
            pTextarea
            name="signature"
            [rows]="signatureRows"
            placeholder="Your name&#10;Role · Organisation"
            [ngModel]="form().signature"
            (ngModelChange)="patch({ signature: $event })"
          ></textarea>
        </label>
        @if (error(); as message) {
          <p class="error wide"><i class="pi pi-exclamation-triangle"></i> {{ message }}</p>
        }
        <p class="ac-muted note wide">
          Stored on your server only. OAuth logins (Microsoft 365, Outlook.com) are not supported
          yet: use an app password.
        </p>
      </form>
      <ng-template #footer>
        <p-button
          label="Cancel"
          severity="secondary"
          [text]="true"
          (onClick)="visible.set(false)"
        />
        <p-button
          [label]="account() ? 'Save' : 'Connect'"
          icon="pi pi-check"
          [loading]="saving()"
          (onClick)="save()"
        />
      </ng-template>
    </p-dialog>
  `,
  styles: `
    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    .field {
      display: flex;
      flex-direction: column;
      gap: 4px;
      font-size: 12px;
      color: var(--ac-muted);
    }
    .wide {
      grid-column: 1 / -1;
    }
    input,
    textarea {
      width: 100%;
    }
    textarea {
      font-family: inherit;
      resize: vertical;
    }
    .color-row {
      display: flex;
      align-items: center;
      gap: 8px;
      .hex {
        width: 100px;
      }
    }
    .help {
      display: flex;
      flex-direction: column;
      gap: 4px;
      p {
        margin: 0;
      }
      a {
        color: var(--p-primary-color);
        font-weight: 600;
      }
    }
    .help,
    .note,
    .error {
      margin: 0;
      font-size: 12px;
    }
    .error {
      color: var(--p-red-500);
    }
    .link {
      padding: 0;
      border: 0;
      background: none;
      color: var(--p-primary-color);
      font-size: 12px;
      text-align: left;
      cursor: pointer;
    }
    @media (max-width: 560px) {
      .grid {
        grid-template-columns: 1fr;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MailAccountDialogComponent {
  private readonly mail = inject(MailApi);

  /** Visibility (two-way). */
  readonly visible = model(false);
  /** Account to edit (`null` creates). */
  readonly account = input<MailAccount | null>(null);
  /** Emits the saved account. */
  readonly saved = output<MailAccount>();

  protected readonly signatureRows = SIGNATURE_ROWS;
  protected readonly form = signal<MailAccountInput>(BLANK);
  protected readonly providerKey = signal<string>(CUSTOM_PROVIDER);
  protected readonly serversOpen = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  private readonly providers = resource({ loader: () => this.mail.providers() });
  /** Presets (empty while loading or on error). */
  private readonly presets = computed(() =>
    this.providers.hasValue() ? this.providers.value() : [],
  );
  protected readonly providerOptions = computed(() => [...this.presets(), CUSTOM_OPTION]);
  /** Selected preset (null for a custom server). */
  protected readonly preset = computed<MailProvider | null>(
    () => this.presets().find((item) => item.key === this.providerKey()) ?? null,
  );
  protected readonly isEws = computed(() => this.form().protocol === 'ews');
  /** Server fields are shown for custom servers, edits and presets without a fixed host. */
  protected readonly showServers = computed(
    () =>
      this.serversOpen() ||
      this.account() !== null ||
      this.preset() === null ||
      this.preset()?.imap_host === '',
  );

  /** Reset the form when the dialog opens. */
  constructor() {
    effect(() => {
      if (this.visible()) {
        untracked(() => {
          this.form.set(formOf(this.account()));
          this.providerKey.set(CUSTOM_PROVIDER);
          this.serversOpen.set(false);
          this.error.set(null);
        });
      }
    });
  }

  /**
   * Change some fields.
   *
   * @param change - Fields.
   */
  protected patch(change: Partial<MailAccountInput>): void {
    this.form.update((form) => ({ ...form, ...change }));
  }

  /**
   * Keep a valid `#rrggbb` color (the picker gives digits without `#`).
   *
   * @param value - Picked or typed color.
   */
  protected setColor(value: string): void {
    const color = normalizeHexColor(value);
    if (color !== null) {
      this.patch({ color });
    }
  }

  /**
   * Fill the servers of a provider preset.
   *
   * @param key - Provider key.
   */
  protected pickProvider(key: string): void {
    this.providerKey.set(key);
    const preset = this.preset();
    if (preset === null) {
      this.patch({ protocol: 'imap' });
      return;
    }
    const { protocol, imap_host, imap_port, smtp_host, smtp_port } = preset;
    this.patch({ protocol, imap_host, imap_port, smtp_host, smtp_port });
  }

  /** Test the login and save. */
  protected async save(): Promise<void> {
    const form = this.form();
    const missingSmtp = form.protocol === 'imap' && form.smtp_host.trim() === '';
    if (form.email.trim() === '' || form.imap_host.trim() === '' || missingSmtp) {
      this.error.set(
        form.protocol === 'ews'
          ? 'Email and server are required.'
          : 'Email and both servers are required.',
      );
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    try {
      const saved = await this.mail.saveAccount(this.account()?.id ?? null, form);
      this.saved.emit(saved);
      this.visible.set(false);
    } catch (error: unknown) {
      this.error.set(toApiProblem(error).message);
    } finally {
      this.saving.set(false);
    }
  }
}
