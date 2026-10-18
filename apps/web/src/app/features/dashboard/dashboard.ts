import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { ApiService } from '../../core/api/api.service';
import type { Branch, Dashboard, EtaStatus } from '../../core/api/models';
import { I18nService } from '../../core/i18n/i18n.service';
import { NotifyService } from '../../core/notify.service';
import { EtaStamp } from '../../shared/eta-stamp';
import { LocalDatePipe, MoneyPipe } from '../../shared/money.pipe';
import { toPiastres } from '../../shared/money';

/** Start of a Cairo calendar day, as an ISO instant (Egypt is UTC+2/+3 with DST, so let Intl resolve it). */
function cairoDayStart(date: string): string {
  const probe = new Date(`${date}T12:00:00Z`);
  const offset = new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Cairo', timeZoneName: 'shortOffset' }).formatToParts(probe).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+2';
  const m = /GMT([+-]\d+)/.exec(offset);
  const hours = m ? Number(m[1]) : 2;
  return new Date(Date.parse(`${date}T00:00:00Z`) - hours * 3600_000).toISOString();
}

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());
const daysAgo = (n: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date(Date.now() - n * 86_400_000));
const nextDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

const STATUS_ORDER: EtaStatus[] = ['VALID', 'SUBMITTED', 'QUEUED', 'SUBMITTING', 'UNKNOWN', 'NOT_SUBMITTED', 'REJECTED', 'INVALID', 'FAILED', 'CANCELLED', 'SUPERSEDED'];

@Component({
  selector: 'app-dashboard',
  imports: [FormsModule, RouterLink, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule, EtaStamp, MoneyPipe, LocalDatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="row top">
      <h1>{{ i18n.t('dash.title') }}</h1>
      <span class="spacer"></span>
      <mat-form-field class="f"><mat-label>{{ i18n.t('common.from') }}</mat-label><input matInput type="date" [(ngModel)]="from" (change)="load()" /></mat-form-field>
      <mat-form-field class="f"><mat-label>{{ i18n.t('common.to') }}</mat-label><input matInput type="date" [(ngModel)]="to" (change)="load()" /></mat-form-field>
      <mat-form-field class="f">
        <mat-label>{{ i18n.t('common.branch') }}</mat-label>
        <mat-select [(ngModel)]="branchId" (selectionChange)="load()">
          <mat-option value="">{{ i18n.t('common.allBranches') }}</mat-option>
          @for (b of branches(); track b.id) { <mat-option [value]="b.id">{{ b.name }}</mat-option> }
        </mat-select>
      </mat-form-field>
    </header>

    @if (data(); as d) {
      <section class="headline panel">
        <div class="figure main">
          <span class="label">{{ i18n.t('dash.net') }}</span>
          <span class="value money">{{ d.netRevenueIncludingTax | money }}</span>
        </div>
        <div class="figure"><span class="label">{{ i18n.t('dash.sales') }}</span><span class="value money">{{ d.sales.totalIncludingTax | money }}</span></div>
        <div class="figure"><span class="label">{{ i18n.t('dash.returns') }}</span><span class="value money">{{ d.returns.totalIncludingTax | money }}</span></div>
        <div class="figure"><span class="label">{{ i18n.t('dash.receipts') }}</span><span class="value num">{{ d.sales.receiptCount }}</span></div>
        <p class="note muted">{{ i18n.t('dash.internalNote') }}</p>
      </section>

      @if (d.daily.length > 1) {
        <section class="panel">
          <h2>{{ i18n.t('dash.sales') }}</h2>
          <div class="bars" role="img" [attr.aria-label]="i18n.t('dash.sales')">
            @for (day of d.daily; track day.day) {
              <div class="bar-col" [title]="day.day + ': ' + (day.sales | money)">
                <div class="bar" [style.height.%]="barHeight(day.sales)"></div>
                <span class="tick num">{{ day.day.slice(8) }}</span>
              </div>
            }
          </div>
        </section>
      }

      <div class="grid">
        <section class="panel">
          <h2>{{ i18n.t('dash.eta') }}</h2>
          <ul class="statuses">
            @for (s of etaStatuses(); track s.status) {
              <li><app-eta-stamp [status]="s.status" /><span class="num">{{ s.count }}</span></li>
            }
          </ul>
          <h3>{{ i18n.t('dash.problems') }}</h3>
          @if (d.integrationProblems.length === 0) {
            <p class="muted">{{ i18n.t('dash.noProblems') }}</p>
          } @else {
            <table class="data">
              <tbody>
                @for (p of d.integrationProblems; track p.id) {
                  <tr class="clickable" [routerLink]="['/receipts', p.id]">
                    <td class="num">{{ p.receiptNumber }}</td><td><app-eta-stamp [status]="p.etaStatus" /></td><td class="muted">{{ p.error }}</td>
                  </tr>
                }
              </tbody>
            </table>
          }
        </section>

        <section class="panel">
          <h2>{{ i18n.t('dash.taxes') }}</h2>
          <table class="data">
            <tbody>
              @for (t of d.taxByType; track t.taxType) { <tr><td>{{ t.taxType }}</td><td class="end money">{{ t.netAmount | money }}</td></tr> }
              <tr><td class="muted">{{ i18n.t('dash.grossSales') }}</td><td class="end money">{{ d.sales.grossSales | money }}</td></tr>
              <tr><td class="muted">{{ i18n.t('pos.discounts') }}</td><td class="end money">{{ d.sales.discounts | money }}</td></tr>
            </tbody>
          </table>
          <h3>{{ i18n.t('dash.payments') }}</h3>
          <table class="data">
            <tbody>
              @for (p of d.payments; track $index) {
                <tr><td>{{ i18n.t('pay.' + p.method) }}</td><td class="muted">{{ p.direction === 'IN' ? i18n.t('dash.in') : i18n.t('dash.out') }}</td><td class="end money">{{ p.amount | money }}</td></tr>
              }
            </tbody>
          </table>
        </section>

        <section class="panel">
          <h2>{{ i18n.t('dash.byBranch') }}</h2>
          <table class="data">
            <tbody>
              @for (b of d.byBranch; track b.id) { <tr><td>{{ b.name }}</td><td class="end num">{{ b.salesCount }}</td><td class="end money">{{ b.net | money }}</td></tr> }
            </tbody>
          </table>
          <h3>{{ i18n.t('dash.byDevice') }}</h3>
          <table class="data">
            <tbody>
              @for (b of d.byDevice; track b.id) { <tr><td>{{ b.name }}</td><td class="end num">{{ b.salesCount }}</td><td class="end money">{{ b.net | money }}</td></tr> }
            </tbody>
          </table>
        </section>

        <section class="panel">
          <h2>{{ i18n.t('dash.recent') }}</h2>
          <table class="data">
            <tbody>
              @for (r of d.recentReceipts; track r.id) {
                <tr class="clickable" [routerLink]="['/receipts', r.id]">
                  <td class="num">{{ r.receiptNumber }}</td><td class="muted">{{ r.dateTimeIssued | localDate }}</td><td class="end money">{{ r.totalAmount | money }}</td>
                </tr>
              }
            </tbody>
          </table>
        </section>
      </div>
    } @else if (loading()) {
      <p class="muted">{{ i18n.t('common.loading') }}</p>
    }
  `,
  styles: `
    .top { margin-bottom: 8px; } .top h1 { margin: 0; } .f { width: 170px; }
    .headline { display: grid; grid-template-columns: 2fr repeat(3, 1fr); gap: 24px; align-items: end; margin-bottom: 20px; }
    .figure { display: flex; flex-direction: column; gap: 4px; }
    .figure .label { color: var(--muted); font-size: 0.9rem; }
    .figure .value { font-size: 1.5rem; font-weight: 600; color: var(--ink); }
    .figure.main .value { font-size: 2.6rem; font-weight: 700; }
    .note { grid-column: 1 / -1; margin: 0; font-size: 0.85rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 20px; margin-top: 20px; }
    .statuses { list-style: none; padding: 0; margin: 0 0 16px; display: flex; flex-wrap: wrap; gap: 10px 18px; }
    .statuses li { display: flex; align-items: center; gap: 8px; }
    .bars { display: flex; align-items: flex-end; gap: 4px; height: 140px; }
    .bar-col { flex: 1; display: flex; flex-direction: column; align-items: center; height: 100%; justify-content: flex-end; }
    .bar { width: 100%; max-width: 28px; background: var(--ink-soft); border-radius: 3px 3px 0 0; min-height: 2px; }
    .tick { font-size: 0.7rem; color: var(--muted); }
    @media (max-width: 900px) { .headline { grid-template-columns: 1fr 1fr; } }
    @media (max-width: 600px) { .headline { grid-template-columns: 1fr; gap: 14px; } .figure.main .value { font-size: 2rem; } .f { width: 100%; } }
  `,
})
export class DashboardPage {
  readonly i18n = inject(I18nService);
  private readonly api = inject(ApiService);
  private readonly notify = inject(NotifyService);
  readonly data = signal<Dashboard | null>(null);
  readonly loading = signal(false);
  readonly branches = signal<Branch[]>([]);
  from = daysAgo(6);
  to = today();
  branchId = '';

  readonly etaStatuses = computed(() => {
    const by = this.data()?.eta.byStatus ?? {};
    return STATUS_ORDER.filter((s) => (by[s] ?? 0) > 0).map((s) => ({ status: s, count: by[s] ?? 0 }));
  });
  private readonly maxDaily = computed(() => {
    const vals = (this.data()?.daily ?? []).map((d) => toPiastres(d.sales));
    return vals.reduce((a, b) => (b > a ? b : a), 1n);
  });

  constructor() {
    this.api.get<Branch[]>('/branches').subscribe({ next: (b) => this.branches.set(b), error: () => undefined });
    this.load();
  }

  barHeight(sales: string): number {
    return Number((toPiastres(sales) * 1000n) / this.maxDaily()) / 10;
  }

  load(): void {
    if (!this.from || !this.to) return;
    this.loading.set(true);
    this.api.get<Dashboard>('/reports/dashboard', { from: cairoDayStart(this.from), to: cairoDayStart(nextDay(this.to)), branchId: this.branchId }).subscribe({
      next: (d) => {
        this.data.set(d);
        this.loading.set(false);
      },
      error: (e) => {
        this.loading.set(false);
        this.notify.error(e);
      },
    });
  }
}
