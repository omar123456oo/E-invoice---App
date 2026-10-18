import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { ApiService } from '../../core/api/api.service';
import type { ImportJob, ImportRow, Page } from '../../core/api/models';
import { AuthService } from '../../core/auth/auth.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { NotifyService } from '../../core/notify.service';
import { MoneyPipe } from '../../shared/money.pipe';
import { Paginator } from '../../shared/paginator';

interface ReviewLine { description: string; quantity: string; unitPrice: string; discount: string; taxAmount: string }

@Component({
  selector: 'app-import-detail',
  imports: [FormsModule, MatButtonModule, MatCheckboxModule, MatFormFieldModule, MatInputModule, MoneyPipe, Paginator],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (job(); as j) {
      <header class="row">
        <h1>{{ j.upload?.originalName }}</h1><span class="spacer"></span>
        <button mat-button (click)="downloadFile()">{{ i18n.t('imports.download') }}</button>
      </header>
      <p>{{ i18n.t('imports.purpose.' + j.purpose) }} — <strong [class.error-text]="j.status === 'FAILED'">{{ i18n.t('imports.status.' + j.status) }}</strong>
        — {{ i18n.t('imports.scan') }}: {{ scanStatus() }}</p>
      @if (j.error) { <p class="error-text" role="alert">{{ j.error }}</p> }
      <div class="row">
        @if (j.status === 'FAILED' && auth.can('imports:manage')) { <button mat-flat-button class="btn-primary" (click)="retry()">{{ i18n.t('imports.retry') }}</button> }
        @if (['READY', 'NEEDS_REVIEW', 'FAILED'].includes(j.status) && auth.can('imports:manage')) { <button mat-button (click)="discard()">{{ i18n.t('imports.discard') }}</button> }
      </div>

      @if (j.kind === 'PRODUCTS' && j.status !== 'PENDING' && j.status !== 'PROCESSING') {
        <section class="panel stack">
          <div class="row counts">
            <span>{{ i18n.t('imports.rows') }}: <strong class="num">{{ j.counts.total }}</strong></span>
            <span>{{ i18n.t('imports.valid') }}: <strong class="num ok">{{ j.counts.valid }}</strong></span>
            <span>{{ i18n.t('imports.invalid') }}: <strong class="num" [class.error-text]="j.counts.invalid > 0">{{ j.counts.invalid }}</strong></span>
            @if (j.status === 'COMMITTED') { <span>{{ i18n.t('imports.inserted') }}: <strong class="num">{{ j.counts.inserted }}</strong></span> }
            <span class="spacer"></span>
            <mat-checkbox [(ngModel)]="invalidOnly" (change)="loadRows(1)">{{ i18n.t('imports.invalidOnly') }}</mat-checkbox>
          </div>
          @if (rows(); as r) {
            <table class="data">
              <thead><tr><th>{{ i18n.t('imports.row') }}</th><th>{{ i18n.t('products.internalCode') }}</th><th>{{ i18n.t('products.nameAr') }}</th><th class="end">{{ i18n.t('products.unitPrice') }}</th><th></th></tr></thead>
              <tbody>
                @for (row of r.items; track row.id) {
                  <tr>
                    <td class="num">{{ row.rowNo }}</td><td class="num" dir="ltr">{{ row.data['internalCode'] }}</td><td>{{ row.data['nameAr'] }}</td><td class="end num">{{ row.data['unitPrice'] }}</td>
                    <td>@if (row.valid) { <span class="ok">✓</span> } @else { <ul class="issues">@for (e of row.issues; track $index) { <li><span dir="ltr">{{ e.path }}</span>: {{ e.message }}</li> }</ul> }</td>
                  </tr>
                }
              </tbody>
            </table>
            <app-paginator [page]="r.page" [totalPages]="r.totalPages" (pageChange)="loadRows($event)" />
          }
          @if (j.status === 'READY' && auth.can('products:manage')) {
            <div class="row">
              @if (j.counts.invalid > 0) { <mat-checkbox [(ngModel)]="allowPartial">{{ i18n.t('imports.commitPartial') }}</mat-checkbox> }
              <span class="spacer"></span>
              <button mat-flat-button class="btn-primary" [disabled]="j.counts.valid === 0 || (j.counts.invalid > 0 && !allowPartial)" (click)="commit()">{{ i18n.t('imports.commit') }}</button>
            </div>
          }
        </section>
      }

      @if (j.kind === 'DOCUMENT' && (j.status === 'NEEDS_REVIEW' || j.status === 'REVIEWED')) {
        <form class="panel stack" (ngSubmit)="saveReview()">
          <h2>{{ i18n.t('imports.reviewTitle') }}</h2>
          <p class="muted">{{ i18n.t('imports.reviewNote') }}</p>
          @if (j.extraction; as ex) { @if (ex.provider && ex.provider !== 'none') { <p class="small muted">{{ i18n.t('imports.ocr') }}: {{ ex.provider }} ({{ ex.confidence }})</p> } }
          <div class="grid">
            <mat-form-field><mat-label>{{ i18n.t('imports.docNumber') }}</mat-label><input matInput name="dn" [(ngModel)]="review.documentNumber" dir="ltr" required /></mat-form-field>
            <mat-form-field><mat-label>{{ i18n.t('imports.issueDate') }}</mat-label><input matInput name="dt" type="date" [(ngModel)]="review.issueDate" required /></mat-form-field>
            <mat-form-field><mat-label>{{ i18n.t('imports.seller') }}</mat-label><input matInput name="sn" [(ngModel)]="review.sellerName" required /></mat-form-field>
            <mat-form-field><mat-label>{{ i18n.t('imports.sellerTax') }}</mat-label><input matInput name="st" [(ngModel)]="review.sellerTaxId" dir="ltr" /></mat-form-field>
          </div>
          <table class="data">
            <thead><tr><th>{{ i18n.t('products.description') }}</th><th>{{ i18n.t('pos.qty') }}</th><th>{{ i18n.t('pos.price') }}</th><th>{{ i18n.t('pos.discounts') }}</th><th>{{ i18n.t('imports.lineTax') }}</th><th></th></tr></thead>
            <tbody>
              @for (l of lines(); track $index; let i = $index) {
                <tr>
                  <td><input class="cell" [name]="'d' + i" [(ngModel)]="l.description" /></td>
                  <td><input class="cell n" [name]="'q' + i" [(ngModel)]="l.quantity" inputmode="decimal" dir="ltr" /></td>
                  <td><input class="cell n" [name]="'p' + i" [(ngModel)]="l.unitPrice" inputmode="decimal" dir="ltr" /></td>
                  <td><input class="cell n" [name]="'c' + i" [(ngModel)]="l.discount" inputmode="decimal" dir="ltr" /></td>
                  <td><input class="cell n" [name]="'t' + i" [(ngModel)]="l.taxAmount" inputmode="decimal" dir="ltr" /></td>
                  <td><button mat-button type="button" (click)="removeLine(i)">{{ i18n.t('pos.remove') }}</button></td>
                </tr>
              }
            </tbody>
          </table>
          <div><button mat-button type="button" (click)="addLine()">{{ i18n.t('imports.addLine') }}</button></div>
          <div class="grid">
            <mat-form-field><mat-label>{{ i18n.t('imports.statedNet') }}</mat-label><input matInput name="sn2" [(ngModel)]="stated.net" dir="ltr" /></mat-form-field>
            <mat-form-field><mat-label>{{ i18n.t('imports.statedTax') }}</mat-label><input matInput name="stx" [(ngModel)]="stated.tax" dir="ltr" /></mat-form-field>
            <mat-form-field><mat-label>{{ i18n.t('imports.statedTotal') }}</mat-label><input matInput name="stt" [(ngModel)]="stated.total" dir="ltr" required /></mat-form-field>
          </div>
          @if (differences().length) {
            <div class="diff" role="alert"><ul>@for (d of differences(); track d) { <li>{{ d }}</li> }</ul>
              <mat-checkbox name="acc" [(ngModel)]="acceptDifferences">{{ i18n.t('imports.acceptDiff') }}</mat-checkbox></div>
          }
          @if (j.review; as rv) { <p>{{ i18n.t('imports.computed') }}: <strong class="money">{{ rv.computed.total | money }}</strong></p> }
          @if (auth.can('imports:manage')) { <div class="row"><span class="spacer"></span><button mat-flat-button class="btn-primary" type="submit">{{ i18n.t('imports.saveReview') }}</button></div> }
        </form>
      }
    } @else { <p class="muted">{{ i18n.t('common.loading') }}</p> }
  `,
  styles: `
    header h1 { margin: 0; word-break: break-all; } .counts { gap: 20px; } .ok { color: var(--ok); }
    .issues { margin: 0; padding-inline-start: 16px; color: var(--bad); font-size: 0.85rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 4px 16px; }
    .cell { width: 100%; min-width: 80px; padding: 6px; border: 1px solid var(--line); border-radius: var(--radius-s); font: inherit; } .cell.n { width: 90px; }
    .diff { border: 1.5px solid var(--pending); background: #fbf3e1; border-radius: var(--radius-s); padding: 8px 14px; }
    .small { font-size: 0.8rem; }
  `,
})
export class ImportDetailPage {
  readonly i18n = inject(I18nService);
  readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);
  private readonly notify = inject(NotifyService);
  readonly id = input.required<string>();
  readonly job = signal<ImportJob | null>(null);
  readonly rows = signal<Page<ImportRow> | null>(null);
  readonly lines = signal<ReviewLine[]>([{ description: '', quantity: '1', unitPrice: '', discount: '', taxAmount: '' }]);
  readonly differences = signal<string[]>([]);
  readonly scanStatus = computed(() => {
    const s = this.job()?.upload?.scan;
    const status = typeof s === 'string' ? s : s?.status;
    return status ? this.i18n.t('scan.' + status) : '—';
  });
  invalidOnly = false;
  allowPartial = false;
  acceptDifferences = false;
  review = { documentNumber: '', issueDate: '', sellerName: '', sellerTaxId: '' };
  stated = { net: '', tax: '', total: '' };
  private poll: ReturnType<typeof setInterval> | undefined;

  constructor() {
    effect(() => this.load(this.id()));
    inject(DestroyRef).onDestroy(() => clearInterval(this.poll));
  }

  load(id: string): void {
    this.api.get<ImportJob>(`/imports/${id}`).subscribe({
      next: (j) => {
        this.job.set(j);
        clearInterval(this.poll);
        if (j.status === 'PENDING' || j.status === 'PROCESSING') this.poll = setInterval(() => this.load(id), 2000);
        if (j.kind === 'PRODUCTS' && !['PENDING', 'PROCESSING'].includes(j.status)) this.loadRows(1);
      },
      error: (e) => this.notify.error(e),
    });
  }
  loadRows(page: number): void {
    this.api.get<Page<ImportRow>>(`/imports/${this.id()}/rows`, { page, pageSize: 50, invalidOnly: this.invalidOnly ? 'true' : '' }).subscribe({ next: (r) => this.rows.set(r), error: (e) => this.notify.error(e) });
  }
  commit(): void {
    this.api.post<ImportJob>(`/imports/${this.id()}/commit`, { allowPartial: this.allowPartial }).subscribe({ next: () => this.load(this.id()), error: (e) => this.notify.error(e) });
  }
  retry(): void {
    this.api.post(`/imports/${this.id()}/retry`).subscribe({ next: () => this.load(this.id()), error: (e) => this.notify.error(e) });
  }
  discard(): void {
    this.api.post(`/imports/${this.id()}/reject`, { reason: 'Discarded from import screen' }).subscribe({ next: () => this.load(this.id()), error: (e) => this.notify.error(e) });
  }
  addLine(): void {
    this.lines.update((l) => [...l, { description: '', quantity: '1', unitPrice: '', discount: '', taxAmount: '' }]);
  }
  removeLine(i: number): void {
    this.lines.update((l) => l.filter((_, x) => x !== i));
  }
  saveReview(): void {
    const opt = (v: string) => (v.trim() ? v.trim() : undefined);
    const body = {
      ...this.review, sellerTaxId: opt(this.review.sellerTaxId), currency: 'EGP',
      lines: this.lines().map((l) => ({ description: l.description.trim(), quantity: l.quantity.trim(), unitPrice: l.unitPrice.trim(), discount: opt(l.discount), taxAmount: opt(l.taxAmount) })),
      statedTotals: { net: opt(this.stated.net), tax: opt(this.stated.tax), total: this.stated.total.trim() },
      acceptDifferences: this.acceptDifferences,
    };
    this.api.post<ImportJob>(`/imports/${this.id()}/review`, body).subscribe({
      next: (j) => {
        this.differences.set([]);
        this.job.set({ ...this.job()!, ...j });
        this.notify.success(this.i18n.t('company.saved'));
      },
      error: (e) => {
        const details = (e?.error?.error?.code === 'TOTALS_MISMATCH' ? e.error.error.details : []) as Array<{ message: string }>;
        if (details.length) this.differences.set(details.map((d) => d.message));
        this.notify.error(e);
      },
    });
  }
  downloadFile(): void {
    const up = this.job()?.upload;
    if (!up?.id) return;
    this.api.download(`/imports/uploads/${up.id}/file`).subscribe({
      next: (blob) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = up.originalName;
        a.click();
        URL.revokeObjectURL(a.href);
      },
      error: (e) => this.notify.error(e),
    });
  }
}
