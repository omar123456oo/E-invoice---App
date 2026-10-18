import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import type { ReceiptDetail } from '../../core/api/models';
import { I18nService } from '../../core/i18n/i18n.service';

export interface CorrectionBody {
  reason: string;
  useCurrentProductCodes: boolean;
  lines: Array<{ lineNo: number; itemType?: 'GS1' | 'EGS'; itemCode?: string; unitType?: string }>;
}

/** Collects identification fixes for a corrected receipt. Amounts are not editable by design. */
@Component({
  selector: 'app-correct-dialog',
  imports: [FormsModule, MatDialogModule, MatButtonModule, MatCheckboxModule, MatFormFieldModule, MatInputModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>{{ i18n.t('correct.title') }}</h2>
    <mat-dialog-content class="stack">
      <p class="muted">{{ i18n.t('correct.note') }}</p>
      @if (receipt.eta.lastError; as err) { @if (err.message) { <p class="error-text">{{ err.message }}</p> } }
      <mat-checkbox [(ngModel)]="useCurrent">{{ i18n.t('correct.useCurrent') }}</mat-checkbox>
      @if (!useCurrent) {
        <table class="data">
          <thead><tr><th>#</th><th></th><th>{{ i18n.t('products.etaItemType') }}</th><th>{{ i18n.t('products.etaItemCode') }}</th><th>{{ i18n.t('products.unitType') }}</th></tr></thead>
          <tbody>
            @for (l of lines; track l.lineNo) {
              <tr>
                <td class="num">{{ l.lineNo }}</td><td>{{ l.description }}</td>
                <td><select class="cell" [(ngModel)]="l.itemType" [attr.aria-label]="i18n.t('products.etaItemType')"><option value="EGS">EGS</option><option value="GS1">GS1</option></select></td>
                <td><input class="cell" [(ngModel)]="l.itemCode" dir="ltr" maxlength="100" [attr.aria-label]="i18n.t('products.etaItemCode')" /></td>
                <td><input class="cell short" [(ngModel)]="l.unitType" dir="ltr" maxlength="30" [attr.aria-label]="i18n.t('products.unitType')" /></td>
              </tr>
            }
          </tbody>
        </table>
      }
      <mat-form-field class="full"><mat-label>{{ i18n.t('common.reason') }}</mat-label><input matInput [(ngModel)]="reason" maxlength="500" required /></mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>{{ i18n.t('common.cancel') }}</button>
      <button mat-flat-button class="btn-primary" [disabled]="reason.trim().length < 3" (click)="submit()">{{ i18n.t('correct.submit') }}</button>
    </mat-dialog-actions>
  `,
  styles: `.cell { padding: 6px; border: 1px solid var(--line); border-radius: var(--radius-s); font: inherit; width: 100%; } .cell.short { width: 80px; }`,
})
export class CorrectDialog {
  readonly i18n = inject(I18nService);
  readonly receipt = inject<ReceiptDetail>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<CorrectDialog, CorrectionBody>);
  useCurrent = true;
  reason = '';
  readonly lines = this.receipt.lines.map((l) => ({ lineNo: l.lineNo, description: l.description, itemType: l.itemType as 'GS1' | 'EGS', itemCode: l.itemCode, unitType: l.unitType }));

  submit(): void {
    const changed = this.useCurrent
      ? []
      : this.lines
          .filter((l) => { const o = this.receipt.lines.find((x) => x.lineNo === l.lineNo)!; return o.itemType !== l.itemType || o.itemCode !== l.itemCode.trim() || o.unitType !== l.unitType.trim(); })
          .map((l) => ({ lineNo: l.lineNo, itemType: l.itemType, itemCode: l.itemCode.trim(), unitType: l.unitType.trim() }));
    this.ref.close({ reason: this.reason.trim(), useCurrentProductCodes: this.useCurrent, lines: changed });
  }
}
