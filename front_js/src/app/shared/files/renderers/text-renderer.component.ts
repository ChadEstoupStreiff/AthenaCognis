import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  resource,
} from '@angular/core';
import { CODE_LANGUAGES, extensionOf, type FileKind } from '@domain/files';
import { FilesApi } from '../../../core/files/files.api';
import { formatBytes } from '../../pipes/bytes.pipe';
import { CodeViewComponent } from '../../ui/code-view.component';
import { MarkdownViewComponent } from '../../ui/markdown-view.component';

/** How the text is displayed. */
export type TextDisplay = 'auto' | 'source' | 'text' | 'hex';

const HEX_BYTES = 4_096;
const HEX_ROW = 16;
const HEX_RADIX = 16;
const OFFSET_WIDTH = 8;
const BYTE_WIDTH = 2;
const JSON_INDENT = 2;
const PRINTABLE_MIN = 0x20;
const PRINTABLE_MAX = 0x7e;

/**
 * Format bytes as a hex dump.
 *
 * @param bytes - Bytes.
 * @returns Dump text.
 */
export function hexDump(bytes: Uint8Array): string {
  const lines: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += HEX_ROW) {
    const row = bytes.subarray(offset, offset + HEX_ROW);
    const hex = [...row]
      .map((byte) => byte.toString(HEX_RADIX).padStart(BYTE_WIDTH, '0'))
      .join(' ');
    const ascii = [...row]
      .map((byte) =>
        byte >= PRINTABLE_MIN && byte <= PRINTABLE_MAX ? String.fromCharCode(byte) : '.',
      )
      .join('');
    lines.push(
      `${offset.toString(HEX_RADIX).padStart(OFFSET_WIDTH, '0')}  ${hex.padEnd(HEX_ROW * (BYTE_WIDTH + 1))} ${ascii}`,
    );
  }
  return lines.join('\n');
}

/**
 * Pretty-print JSON when possible.
 *
 * @param text - Raw text.
 * @returns Indented JSON, or the raw text.
 */
function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, JSON_INDENT);
  } catch {
    return text;
  }
}

/** Markdown, JSON, code, plain text or hex view of a file. */
@Component({
  selector: 'ac-text-renderer',
  imports: [CodeViewComponent, MarkdownViewComponent],
  template: `
    @if (content.isLoading()) {
      <div class="ac-muted loading"><i class="pi pi-spin pi-spinner"></i> Loading…</div>
    } @else if (content.value(); as loaded) {
      @if (loaded.truncated) {
        <p class="ac-muted note">Showing the first {{ size(loaded.bytes.length) }}.</p>
      }
      @if (mode() === 'markdown') {
        <ac-markdown-view class="markdown" [source]="loaded.text" />
      } @else {
        <ac-code-view [code]="body()" [language]="language()" />
      }
    }
  `,
  styles: `
    .loading,
    .note {
      padding: 8px 0;
      margin: 0;
      font-size: 12px;
    }
    .markdown {
      display: block;
      padding: 4px 8px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TextRendererComponent {
  private readonly files = inject(FilesApi);

  /** Shared path. */
  readonly path = input.required<string>();
  /** File kind. */
  readonly kind = input.required<FileKind>();
  /** Forced display. */
  readonly display = input<TextDisplay>('auto');

  protected readonly content = resource({
    params: () => ({ path: this.path(), hex: this.display() === 'hex' }),
    loader: ({ params }) => this.files.textHead(params.path, params.hex ? HEX_BYTES : undefined),
  });

  protected readonly mode = computed(() => {
    const display = this.display();
    if (display === 'source') {
      return 'code';
    }
    if (display !== 'auto') {
      return display;
    }
    return this.kind() === 'markdown' ? 'markdown' : 'code';
  });

  protected readonly language = computed(() => {
    if (this.mode() !== 'code') {
      return 'plaintext';
    }
    const kind = this.kind();
    if (kind === 'json' || kind === 'markdown') {
      return kind;
    }
    return kind === 'html' ? 'xml' : (CODE_LANGUAGES[extensionOf(this.path())] ?? 'plaintext');
  });

  protected readonly body = computed(() => {
    const loaded = this.content.value();
    if (loaded === undefined) {
      return '';
    }
    if (this.mode() === 'hex') {
      return hexDump(loaded.bytes);
    }
    return this.kind() === 'json' && !loaded.truncated ? prettyJson(loaded.text) : loaded.text;
  });

  /**
   * Format a size.
   *
   * @param bytes - Byte count.
   * @returns Label.
   */
  protected size(bytes: number): string {
    return formatBytes(bytes);
  }
}
