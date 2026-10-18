import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { ApiService } from '../../core/api/api.service';
import type { AppNotification, Page } from '../../core/api/models';
import { I18nService } from '../../core/i18n/i18n.service';
import { NotificationsService } from '../../core/notifications.service';
import { NotifyService } from '../../core/notify.service';
import { EmptyState } from '../../shared/empty-state';
import { LocalDatePipe } from '../../shared/money.pipe';
import { Paginator } from '../../shared/paginator';

@Component({
  selector: 'app-notifications',
  imports: [MatButtonModule, LocalDatePipe, Paginator, EmptyState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="row"><h1>{{ i18n.t('notif.title') }}</h1><span class="spacer"></span>
      <button mat-stroked-button (click)="readAll()">{{ i18n.t('notif.markAll') }}</button>
    </header>
    <section class="panel">
      @if (page(); as p) {
        @if (p.items.length === 0) { <app-empty-state [message]="i18n.t('notif.empty')" /> } @else {
          <ul class="list">
            @for (n of p.items; track n.id) {
              <li [class.unread]="!n.readAt" [class]="'sev-' + n.severity">
                <div class="head"><strong>{{ text(n.title) }}</strong><span class="muted small">{{ n.createdAt | localDate }}</span></div>
                <p>{{ text(n.body) }}</p>
                <div class="row">
                  @if (n.link) { <button mat-stroked-button (click)="open(n)">{{ i18n.t('notif.open') }}</button> }
                  @if (!n.readAt) { <button mat-button (click)="markRead(n)">{{ i18n.t('notif.markRead') }}</button> }
                </div>
              </li>
            }
          </ul>
          <app-paginator [page]="p.page" [totalPages]="p.totalPages" (pageChange)="load($event)" />
        }
      } @else { <p class="muted">{{ i18n.t('common.loading') }}</p> }
    </section>
  `,
  styles: `
    header h1 { margin: 0; } .small { font-size: 0.8rem; }
    .list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; }
    .list li { padding: 14px 16px; border-bottom: 1px solid var(--line); border-inline-start: 4px solid transparent; }
    .list li.unread { background: #f8faf9; }
    .list li.sev-warning { border-inline-start-color: var(--pending); }
    .list li.sev-critical { border-inline-start-color: var(--bad); }
    .head { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    p { margin: 6px 0 8px; }
  `,
})
export class NotificationsPage {
  readonly i18n = inject(I18nService);
  private readonly api = inject(ApiService);
  private readonly notify = inject(NotifyService);
  private readonly counter = inject(NotificationsService);
  private readonly router = inject(Router);
  readonly page = signal<Page<AppNotification> | null>(null);

  constructor() {
    this.load(1);
  }
  text(t: { en: string; ar: string }): string {
    return this.i18n.lang() === 'ar' ? t.ar : t.en;
  }
  load(page: number): void {
    this.api.get<Page<AppNotification>>('/notifications', { page, pageSize: 25 }).subscribe({ next: (p) => this.page.set(p), error: (e) => this.notify.error(e) });
  }
  markRead(n: AppNotification): void {
    this.api.post(`/notifications/${n.id}/read`).subscribe({ next: () => { this.load(this.page()?.page ?? 1); this.counter.refresh(); }, error: (e) => this.notify.error(e) });
  }
  readAll(): void {
    this.api.post('/notifications/read-all').subscribe({ next: () => { this.load(1); this.counter.refresh(); }, error: (e) => this.notify.error(e) });
  }
  open(n: AppNotification): void {
    if (!n.readAt) this.api.post(`/notifications/${n.id}/read`).subscribe({ next: () => this.counter.refresh(), error: () => undefined });
    if (n.link?.startsWith('/')) void this.router.navigateByUrl(n.link);
  }
}
