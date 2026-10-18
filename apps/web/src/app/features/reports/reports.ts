import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { ApiService } from '../../core/api/api.service';
import type { Branch } from '../../core/api/models';
import { I18nService } from '../../core/i18n/i18n.service';
import { NotifyService } from '../../core/notify.service';
import { EmptyState } from '../../shared/empty-state';

const REPORTS = ['sales-by-product', 'sales-by-cashier', 'tax-summary', 'refunds', 'eta-processing', 'shift-reconciliation'];
const cairo = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(d);

/** Day boundaries are sent as Cairo-local midnight (offset resolved by Intl, DST-safe). */
function cairoStart(date: string): string {
  const probe = new Date(`${date}T12:00:00Z`);
  const tz = new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Cairo', timeZoneName: 'shortOffset' }).formatToParts(probe).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+2';
  const h = Number(/GMT([+-]\d+)/.exec(tz)?.[1] ?? 2);
  return new Date(Date.parse(`${date}T00:00:00Z`) - h * 3600_000).toISOString();
}
const nextDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

@Component({
  selector: 'app-reports',
  imports: [FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule, EmptyState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>{{ i18n.t('reports.title') }}</h1>
    <p class="muted">{{ i18n.t('reports.note') }}</p>
    <form class="row" (ngSubmit)="run()">
      <mat-form-field class="w"><mat-label>{{ i18n.t('reports.type') }}</mat-label>
        <mat-select name="r" [(ngModel)]="report">@for (r of reports; track r) { <mat-option [value]="r">{{ i18n.t('reports.' + r) }}</mat-option> }</mat-select>
      </mat-form-field>
      <mat-form-field><mat-label>{{ i18n.t('common.from') }}</mat-label><input matInput name="f" type="date" [(ngModel)]="from" /></mat-form-field>
      <mat-form-field><mat-label>{{ i18n.t('common.to') }}</mat-label><input matInput name="t" type="date" [(ngModel)]="to" /></mat-form-field>
      <mat-form-field><mat-label>{{ i18n.t('common.branch') }}</mat-label>
        <mat-select name="b" [(ngModel)]="branchId"><mat-option value="">{{ i18n.t('common.allBranches') }}</mat-option>@for (b of branches(); track b.id) { <mat-option [value]="b.id">{{ b.name }}</mat-option> }</mat-select>
      </mat-form-field>
      <button mat-flat-button class="btn-primary" type="submit">{{ i18n.t('reports.run') }}</button>
      <button mat-stroked-button type="button" (click)="export('csv')">{{ i18n.t('common.export') }}</button>
      <button mat-stroked-button type="button" (click)="export('xlsx')">{{ i18n.t('reports.xlsx') }}</button>
    </form>
    <section class="panel">
      @if (rows(); as r) {
        @if (r.length === 0) { <app-empty-state [message]="i18n.t('common.noResults')" /> } @else {
          <table class="data">
            <thead><tr>@for (c of columns(); track c) { <th>{{ i18n.t('col.' + c) }}</th> }</tr></thead>
            <tbody>@for (row of r; track $index) { <tr>@for (c of columns(); track c) { <td [class.num]="isNum(row[c])" dir="auto">{{ cell(row[c]) }}</td> }</tr> }</tbody>
          </table>
        }
      } @else { <p class="muted">{{ i18n.t('reports.run') }}</p> }
    </section>
  `,
  styles: `.w { width: 260px; }`,
})
export class ReportsPage {
  readonly i18n = inject(I18nService);
  private readonly api = inject(ApiService);
  private readonly notify = inject(NotifyService);
  readonly reports = REPORTS;
  readonly branches = signal<Branch[]>([]);
  readonly rows = signal<Array<Record<string, unknown>> | null>(null);
  readonly columns = computed(() => Object.keys(this.rows()?.[0] ?? {}));
  report = 'tax-summary';
  from = cairo(new Date(Date.now() - 6 * 86_400_000));
  to = cairo(new Date());
  branchId = '';

  constructor() {
    this.api.get<Branch[]>('/branches').subscribe({ next: (b) => this.branches.set(b), error: () => undefined });
  }
  private params(format: string) {
    return { from: cairoStart(this.from), to: cairoStart(nextDay(this.to)), branchId: this.branchId, format };
  }
  run(): void {
    this.api.get<{ items: Array<Record<string, unknown>> }>(`/reports/${this.report}`, this.params('json')).subscribe({ next: (r) => this.rows.set(r.items), error: (e) => this.notify.error(e) });
  }
  export(format: 'csv' | 'xlsx'): void {
    this.api.download(`/reports/${this.report}`, this.params(format)).subscribe({
      next: (blob) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${this.report}.${format}`;
        a.click();
        URL.revokeObjectURL(a.href);
      },
      error: (e) => this.notify.error(e),
    });
  }
  isNum(v: unknown): boolean {
    return typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v);
  }
  cell(v: unknown): string {
    if (v === null || v === undefined) return '';
    if (typeof v === 'string' && /^[A-Z_]{3,}$/.test(v) && this.i18n.t('eta.status.' + v) !== 'eta.status.' + v) return this.i18n.t('eta.status.' + v);
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return new Intl.DateTimeFormat(this.i18n.locale, { timeZone: 'Africa/Cairo', dateStyle: 'short', timeStyle: 'short' }).format(new Date(v));
    return Array.isArray(v) ? v.join(', ') : String(v);
  }
}
