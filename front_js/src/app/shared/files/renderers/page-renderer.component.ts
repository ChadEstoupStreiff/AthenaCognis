import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  resource,
} from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';

const SCRIPT_TAG = /<script\b/i;
const SCRIPTS_QUERY = 'scripts=1';

/**
 * Rendered HTML page or SVG drawing.
 *
 * HTML is sandboxed twice (iframe `sandbox` + nginx `Content-Security-Policy: sandbox`): it gets an
 * opaque origin, so it can never read the app, its storage or API responses. Scripts stay blocked
 * unless the user asks to run them (nginx relaxes the policy only for `?scripts=1`).
 */
@Component({
  selector: 'ac-page-renderer',
  imports: [ButtonModule, TooltipModule],
  template: `
    @if (svg()) {
      <div class="canvas"><img [src]="url()" [alt]="title()" /></div>
    } @else {
      @if (hasScripts.value() && !scriptsOn()) {
        <div class="notice">
          <i class="pi pi-shield" aria-hidden="true"></i>
          <span>This page uses scripts. They are blocked, so parts of it may be missing.</span>
          <p-button
            label="Run scripts"
            icon="pi pi-play"
            size="small"
            [outlined]="true"
            pTooltip="Scripts run isolated from the app: no access to its pages or storage."
            (onClick)="scriptsOn.set(true)"
          />
        </div>
      }
      @if (scriptsOn()) {
        <iframe
          class="page"
          [src]="scriptFrameUrl()"
          [title]="title()"
          sandbox="allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox"
          referrerpolicy="no-referrer"
        ></iframe>
      } @else {
        <iframe
          class="page"
          [src]="frameUrl()"
          [title]="title()"
          sandbox="allow-popups allow-popups-to-escape-sandbox"
          referrerpolicy="no-referrer"
        ></iframe>
      }
    }
  `,
  styles: `
    .page {
      display: block;
      width: 100%;
      height: var(--pdf-height, 82vh);
      border: 1px solid var(--ac-panel-border);
      border-radius: 8px;
      background: #fff;
    }
    .notice {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px 12px;
      margin-bottom: 8px;
      padding: 8px 12px;
      border-radius: 8px;
      background: color-mix(in srgb, var(--p-orange-500) 10%, transparent);
      font-size: 13px;

      i {
        color: var(--p-orange-500);
      }

      span {
        flex: 1;
        min-width: 200px;
      }
    }
    /* Checkerboard behind transparent drawings, readable in both themes. */
    .canvas {
      display: flex;
      justify-content: center;
      padding: 16px;
      border-radius: 8px;
      background: repeating-conic-gradient(#e5e7eb 0% 25%, #fff 0% 50%) 50% / 20px 20px;
    }
    img {
      display: block;
      width: 100%;
      max-height: var(--pdf-height, 78vh);
      object-fit: contain;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PageRendererComponent {
  private readonly sanitizer = inject(DomSanitizer);

  /** Inline URL of the file. */
  readonly url = input.required<string>();
  /** SVG drawing (shown as an image) instead of an HTML page. */
  readonly svg = input(false);
  /** Accessible title. */
  readonly title = input('');

  protected readonly scriptsOn = linkedSignal({ source: this.url, computation: () => false });
  protected readonly hasScripts = resource({
    params: () => (this.svg() ? undefined : this.url()),
    loader: async ({ params, abortSignal }) => {
      const response = await fetch(params, { signal: abortSignal });
      return response.ok && SCRIPT_TAG.test(await response.text());
    },
  });
  protected readonly frameUrl = computed(() =>
    this.sanitizer.bypassSecurityTrustResourceUrl(this.url()),
  );
  protected readonly scriptFrameUrl = computed(() =>
    this.sanitizer.bypassSecurityTrustResourceUrl(`${this.url()}?${SCRIPTS_QUERY}`),
  );
}
