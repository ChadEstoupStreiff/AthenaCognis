import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  resource,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SelectModule } from 'primeng/select';
import { TableModule } from 'primeng/table';
import { FilesApi } from '../../../core/files/files.api';
import { toApiProblem } from '../../../core/api/api-error';

const SCROLL_HEIGHT = '70vh';
const VIRTUAL_ROW_HEIGHT = 33;

/** CSV/TSV/XLSX preview (parsed by the BFF). */
@Component({
  selector: 'ac-table-renderer',
  imports: [FormsModule, SelectModule, TableModule],
  template: `
    @if (table.isLoading()) {
      <div class="ac-muted"><i class="pi pi-spin pi-spinner"></i> Reading table…</div>
    } @else if (error(); as message) {
      <div class="ac-muted">{{ message }}</div>
    } @else if (table.value(); as preview) {
      <div class="head">
        @if (preview.sheets.length > 1) {
          <p-select
            [options]="sheetOptions()"
            [ngModel]="preview.sheet"
            (ngModelChange)="sheet.set($event)"
            size="small"
            ariaLabel="Sheet"
          />
        }
        <span class="ac-muted"
          >{{ preview.totalRows }} rows{{
            preview.truncated ? ' (showing ' + preview.rows.length + ')' : ''
          }}</span
        >
      </div>
      <p-table
        [value]="rowObjects()"
        [scrollable]="true"
        [scrollHeight]="scrollHeight"
        [virtualScroll]="preview.rows.length > 200"
        [virtualScrollItemSize]="rowHeight"
        size="small"
        [showGridlines]="true"
      >
        <ng-template #header>
          <tr>
            @for (column of preview.columns; track $index) {
              <th>{{ column }}</th>
            }
          </tr>
        </ng-template>
        <ng-template #body let-row>
          <tr>
            @for (cell of row.cells; track $index) {
              <td>{{ cell }}</td>
            }
          </tr>
        </ng-template>
      </p-table>
    }
  `,
  styles: `
    .head {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 8px;
      font-size: 12px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TableRendererComponent {
  private readonly files = inject(FilesApi);

  /** Shared path. */
  readonly path = input.required<string>();

  protected readonly sheet = signal<string | undefined>(undefined);
  protected readonly scrollHeight = SCROLL_HEIGHT;
  protected readonly rowHeight = VIRTUAL_ROW_HEIGHT;
  protected readonly table = resource({
    params: () => ({ path: this.path(), sheet: this.sheet() }),
    loader: ({ params }) => this.files.table(params.path, params.sheet),
  });
  protected readonly error = computed(() => {
    const failure = this.table.error();
    return failure === undefined ? null : toApiProblem(failure).message;
  });
  protected readonly sheetOptions = computed(
    () => this.table.value()?.sheets.map((name) => ({ label: name, value: name })) ?? [],
  );
  protected readonly rowObjects = computed(() =>
    (this.table.value()?.rows ?? []).map((cells) => ({ cells })),
  );
}
