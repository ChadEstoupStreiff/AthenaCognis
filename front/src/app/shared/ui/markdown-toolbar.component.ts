import {
  ChangeDetectionStrategy,
  Component,
  type ElementRef,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import type { MenuItem } from 'primeng/api';
import { MenuModule } from 'primeng/menu';
import { PopoverModule } from 'primeng/popover';
import { TooltipModule } from 'primeng/tooltip';
import { formatLocalDate } from '@domain/time';
import { NotifyService } from '../../core/notify/notify.service';
import { EMOJIS } from '../text/emoji';
import { buildTable, styledSpan } from '../text/markdown-format';
import type { MarkdownEditorComponent } from './markdown-editor.component';
import {
  type ActionTool,
  BLOCK_TOOLS,
  CALLOUTS,
  calloutBlock,
  CHEATSHEET,
  DEFAULT_CUSTOM_COLOR,
  FONT_SIZES,
  HIGHLIGHT_COLORS,
  HISTORY_TOOLS,
  IMAGE_WIDTHS,
  INLINE_TOOLS,
  type InlineTool,
  INSERT_BLOCKS,
  MAX_HEADING_LEVEL,
  TABLE_PICKER_COLUMNS,
  TABLE_PICKER_ROWS,
  TABLE_TOOLS,
  type TableTool,
  TEXT_COLORS,
} from './markdown-toolbar.tools';

/** Cell of the table size picker. */
interface TableCell {
  readonly rows: number;
  readonly columns: number;
}

const TIME_OPTIONS: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };
const NO_TABLE = 'Place the cursor inside a table first.';
const NO_IMAGE = 'Select an image (or put the cursor on its line) first.';

/** Formatting toolbar driving a Markdown editor. */
@Component({
  selector: 'ac-markdown-toolbar',
  imports: [MenuModule, PopoverModule, TooltipModule],
  templateUrl: './markdown-toolbar.component.html',
  styleUrl: './markdown-toolbar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MarkdownToolbarComponent {
  private readonly notify = inject(NotifyService);

  /** Editor the toolbar formats. */
  readonly editor = input.required<MarkdownEditorComponent | undefined>();
  /** Show file tools (needs a file uploader on the editor). */
  readonly files = input(false);
  /** Show app links (people, tags, projects, files, agenda). */
  readonly appLinks = input(false);
  /** Asks the host to pick a file to embed as a preview card. */
  readonly embedFile = output();
  /** Asks the host to insert today's agenda. */
  readonly insertAgenda = output();

  protected readonly historyTools = HISTORY_TOOLS;
  protected readonly inlineTools = INLINE_TOOLS;
  protected readonly blockTools = BLOCK_TOOLS;
  protected readonly tableTools = TABLE_TOOLS;
  protected readonly textColors = TEXT_COLORS;
  protected readonly highlightColors = HIGHLIGHT_COLORS;
  protected readonly emojis = EMOJIS;
  protected readonly cheatsheet = CHEATSHEET;
  protected readonly customColor = signal(DEFAULT_CUSTOM_COLOR);
  protected readonly tableHover = signal<TableCell>({ rows: 0, columns: 0 });
  protected readonly tableCells: readonly (readonly TableCell[])[] = Array.from(
    { length: TABLE_PICKER_ROWS },
    (_, row) =>
      Array.from({ length: TABLE_PICKER_COLUMNS }, (_, column) => ({
        rows: row + 1,
        columns: column + 1,
      })),
  );
  protected readonly headingItems: MenuItem[] = [
    { label: 'Paragraph', command: () => this.editor()?.heading(0) },
    ...Array.from({ length: MAX_HEADING_LEVEL }, (_, index) => ({
      label: `Heading ${String(index + 1)}`,
      command: (): void => {
        this.editor()?.heading(index + 1);
      },
    })),
  ];
  protected readonly sizeItems: MenuItem[] = FONT_SIZES.map((size) => ({
    label: size.label,
    command: (): void => {
      this.style('font-size', size.value);
    },
  }));
  protected readonly insertItems: MenuItem[] = [
    ...CALLOUTS.map((kind) => ({
      label: `${kind} callout`,
      icon: 'pi pi-info-circle',
      command: (): void => {
        this.editor()?.block(calloutBlock(kind));
      },
    })),
    { separator: true },
    ...INSERT_BLOCKS.map((item) => ({
      label: item.label,
      icon: item.icon,
      command: (): void => {
        this.editor()?.block(item.block);
      },
    })),
    { separator: true },
    {
      label: 'Date',
      icon: 'pi pi-calendar',
      command: (): void => {
        this.editor()?.insert(formatLocalDate(new Date()));
      },
    },
    {
      label: 'Time',
      icon: 'pi pi-clock',
      command: (): void => {
        this.editor()?.insert(new Date().toLocaleTimeString([], TIME_OPTIONS));
      },
    },
  ];
  protected readonly imageItems: MenuItem[] = [
    {
      label: 'Upload image…',
      icon: 'pi pi-upload',
      command: (): void => {
        this.pickFiles('image/*');
      },
    },
    { separator: true },
    ...IMAGE_WIDTHS.map((width) => ({
      label: `Width ${width}`,
      icon: 'pi pi-arrows-h',
      command: (): void => {
        this.editImage((image) => ({ ...image, width: width === '100%' ? null : width }));
      },
    })),
    {
      label: 'Toggle caption',
      icon: 'pi pi-tag',
      command: (): void => {
        this.editImage((image) => ({ ...image, caption: !image.caption }));
      },
    },
  ];
  protected readonly linkItems: MenuItem[] = [
    {
      label: 'Person (@)',
      icon: 'pi pi-user',
      command: (): void => {
        this.complete('@');
      },
    },
    {
      label: 'Tag (#)',
      icon: 'pi pi-hashtag',
      command: (): void => {
        this.complete('#');
      },
    },
    {
      label: 'Project (+)',
      icon: 'pi pi-briefcase',
      command: (): void => {
        this.complete('+');
      },
    },
    {
      label: 'Post-it or file ([[)',
      icon: 'pi pi-file',
      command: (): void => {
        this.complete('[[');
      },
    },
    {
      label: 'Embed file preview…',
      icon: 'pi pi-images',
      command: (): void => {
        this.embedFile.emit();
      },
    },
    {
      label: "Today's agenda",
      icon: 'pi pi-calendar-clock',
      command: (): void => {
        this.insertAgenda.emit();
      },
    },
  ];
  private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');

  /**
   * Apply an inline tool.
   *
   * @param tool - Tool.
   */
  protected inline(tool: InlineTool): void {
    this.editor()?.wrap(tool.before, tool.after);
  }

  /**
   * Run an action tool.
   *
   * @param tool - Tool.
   */
  protected run(tool: ActionTool): void {
    const editor = this.editor();
    if (editor !== undefined) {
      tool.run(editor);
    }
  }

  /**
   * Insert an emoji.
   *
   * @param char - Emoji.
   */
  protected emoji(char: string): void {
    this.editor()?.insert(char);
  }

  /**
   * Wrap the selection in a styled span.
   *
   * @param property - CSS property.
   * @param value - CSS value.
   */
  protected style(property: string, value: string): void {
    const { before, after } = styledSpan(property, value);
    this.editor()?.wrap(before, after);
  }

  /**
   * Remember the custom color picked in the native color input.
   *
   * @param event - Input event.
   */
  protected pickCustomColor(event: Event): void {
    if (event.target instanceof HTMLInputElement) {
      this.customColor.set(event.target.value);
    }
  }

  /**
   * Insert an empty table.
   *
   * @param cell - Picked size.
   */
  protected insertTable(cell: TableCell): void {
    this.editor()?.block(buildTable(cell.rows, cell.columns));
  }

  /**
   * Edit the table under the cursor.
   *
   * @param tool - Table tool.
   */
  protected editTable(tool: TableTool): void {
    if (this.editor()?.table(tool.operation) !== true) {
      this.notify.info(NO_TABLE);
    }
  }

  /**
   * Open the file picker.
   *
   * @param accept - Accepted types (empty = any file).
   */
  protected pickFiles(accept = ''): void {
    const element = this.fileInput()?.nativeElement;
    if (element !== undefined) {
      element.accept = accept;
      element.click();
    }
  }

  /**
   * Upload the picked files.
   *
   * @param event - Change event of the file input.
   */
  protected filesPicked(event: Event): void {
    if (!(event.target instanceof HTMLInputElement)) {
      return;
    }
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    void this.editor()?.insertFiles(files);
  }

  /**
   * Insert a completion trigger.
   *
   * @param trigger - Trigger text.
   */
  private complete(trigger: string): void {
    this.editor()?.insertAndComplete(trigger);
  }

  /**
   * Resize or caption the selected image.
   *
   * @param transform - Image transform.
   */
  private editImage(transform: Parameters<MarkdownEditorComponent['image']>[0]): void {
    if (this.editor()?.image(transform) !== true) {
      this.notify.info(NO_IMAGE);
    }
  }
}
