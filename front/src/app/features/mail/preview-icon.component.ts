import { ChangeDetectionStrategy, Component, input } from '@angular/core';

const DEFAULT_SIZE = 16;

/** Mail Preview glyph: summary lines with a small sparkle (drawn in `currentColor`). */
@Component({
  selector: 'ac-preview-icon',
  template: `
    <svg
      [attr.width]="size()"
      [attr.height]="size()"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M1.5 4h7M1.5 8h9M1.5 12h6"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
      />
      <path
        d="M12.75 1.25l.62 1.63 1.63.62-1.63.62-.62 1.63-.62-1.63-1.63-.62 1.63-.62z"
        fill="currentColor"
      />
      <path
        d="M12.25 8.75l.4 1.1 1.1.4-1.1.4-.4 1.1-.4-1.1-1.1-.4 1.1-.4z"
        fill="currentColor"
        opacity="0.7"
      />
    </svg>
  `,
  styles: `
    :host {
      display: inline-flex;
      line-height: 0;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PreviewIconComponent {
  /** Size in pixels. */
  readonly size = input(DEFAULT_SIZE);
}
