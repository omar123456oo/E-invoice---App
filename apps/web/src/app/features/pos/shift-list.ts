import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ApiService } from '../../core/api/api.service';
import type { Page, Shift } from '../../core/api/models';
import { I18nService } from '../../core/i18n/i18n.service';
import { NotifyService } from '../../core/notify.service';
import { EmptyState } from '../../shared/empty-state';
import { LocalDatePipe, MoneyPipe } from '../../shared/money.pipe';
import { Paginator } from '../../shared/paginator';

@Component({
  selector: 'app-shift-list',
  imports: [MoneyPipe, LocalDatePipe, Paginator, EmptyState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>{{ i18n.t('shifts.title') }}</h1>
    <section class="panel">
      @if (page(); as p) {
        @if (p.items.length === 0) { <app-empty-state [message]="i18n.t('common.noResults')" /> } @else {
          <table class="data">
            <thead><tr>
              <th>{{ i18n.t('shifts.opened') }}</th><th>{{ i18n.t('shifts.closed') }}</th><th>{{ i18n.t('common.status') }}</th>
              <th class="end">{{ i18n.t('pos.openingCash') }}</th><th class="end">{{ i18n.t('pos.expected') }}</th><th class="end">{{ i18n.t('pos.countedCash') }}</th><th class="end">{{ i18n.t('pos.variance') }}</th>
            </tr></thead>
            <tbody>
              @for (s of p.items; track s.id) {
                <tr>
                  <td>{{ s.openedAt | localDate }}</td><td>{{ s.closedAt | localDate }}</td>
                  <td>{{ s.status === 'OPEN' ? i18n.t('common.active') : i18n.t('shifts.closed') }}</td>
                  <td class="end money">{{ s.openingCash | money }}</td>
                  <td class="end money">{{ (s.expectedCash ?? s.live?.expected) | money }}</td>
                  <td class="end money">{{ s.countedCash | money }}</td>
                  <td class="end money" [class.error-text]="s.variance && s.variance !== '0.00'">{{ s.variance | money }}</td>
                </tr>
              }
            </tbody>
          </table>
          <app-paginator [page]="p.page" [totalPages]="p.totalPages" (pageChange)="load($event)" />
        }
      } @else { <p class="muted">{{ i18n.t('common.loading') }}</p> }
    </section>
  `,
})
export class ShiftListPage {
  readonly i18n = inject(I18nService);
  private readonly api = inject(ApiService);
  private readonly notify = inject(NotifyService);
  readonly page = signal<Page<Shift> | null>(null);
  constructor() {
    this.load(1);
  }
  load(page: number): void {
    this.api.get<Page<Shift>>('/pos/shifts', { page, pageSize: 25 }).subscribe({ next: (p) => this.page.set(p), error: (e) => this.notify.error(e) });
  }
}
