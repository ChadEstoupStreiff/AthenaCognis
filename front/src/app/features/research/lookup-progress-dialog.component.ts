import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { OperationProgressDialogComponent } from '../../shared/ui/operation-progress-dialog.component';
import { ResearchStore } from './research.store';

/** Blocking progress of "Find info": runs in this tab, so the user must keep it open. */
@Component({
  selector: 'ac-lookup-progress-dialog',
  imports: [ButtonModule, OperationProgressDialogComponent],
  template: `
    <ac-operation-progress-dialog
      header="Finding paper info"
      unit="paper(s)"
      verb="Searching"
      [operation]="store.lookupOperation()"
      [item]="store.lookupCurrent()"
      (closed)="store.closeLookup()"
    >
      <p-button
        actions
        label="Show papers to review"
        icon="pi pi-filter"
        (onClick)="showToReview()"
      />
    </ac-operation-progress-dialog>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LookupProgressDialogComponent {
  protected readonly store = inject(ResearchStore);

  /** Close and filter the library on papers to review. */
  protected showToReview(): void {
    this.store.closeLookup();
    this.store.status.set('To review');
  }
}
