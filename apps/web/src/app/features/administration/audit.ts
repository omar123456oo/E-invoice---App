import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { ApiService } from '../../core/api/api.service';
import type { AuditEvent, Page } from '../../core/api/models';
import { I18nService } from '../../core/i18n/i18n.service';
import { NotifyService } from '../../core/notify.service';
import { LocalDatePipe } from '../../shared/money.pipe';
import { Paginator } from '../../shared/paginator';

@Component({
  selector: 'app-audit',
  imports: [FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, LocalDatePipe, Paginator],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="row"><h1>{{ i18n.t('audit.title') }}</h1><span class="spacer"></span>
      <button mat-stroked-button (click)="verify()">{{ i18n.t('audit.verify') }}</button>
    </header>
    @if (verification(); as v) { <p role="status" [class.error-text]="!v.valid">{{ v.valid ? i18n.t('audit.valid', { n: v.checked }) : i18n.t('audit.invalid', { n: v.brokenAtSeq ?? '?' }) }}</p> }
    <form class="row" (ngSubmit)="load(1)">
      <mat-form-field><mat-label>{{ i18n.t('audit.action') }}</mat-label><input matInput name="a" [(ngModel)]="action" dir="ltr" /></mat-form-field>
      <button mat-stroked-button type="submit">{{ i18n.t('common.search') }}</button>
    </form>
    <section class="panel">
      @if (page(); as p) {
        <table class="data">
          <thead><tr><th>{{ i18n.t('common.date') }}</th><th>{{ i18n.t('audit.action') }}</th><th>{{ i18n.t('audit.outcome') }}</th><th>{{ i18n.t('audit.actor') }}</th><th>{{ i18n.t('audit.entity') }}</th><th></th></tr></thead>
          <tbody>
            @for (e of p.items; track e.id) {
              <tr>
                <td>{{ e.at | localDate }}</td><td dir="ltr" class="num">{{ e.action }}</td>
                <td [class.error-text]="e.outcome === 'failure'">{{ e.outcome }}</td>
                <td>{{ e.actor.role ? i18n.t('role.' + e.actor.role) : e.actor.type }}</td>
                <td dir="ltr" class="small">{{ e.entityType }} {{ e.entityId }}</td>
                <td class="small">{{ e.summary }}</td>
              </tr>
            }
          </tbody>
        </table>
        <app-paginator [page]="p.page" [totalPages]="p.totalPages" (pageChange)="load($event)" />
      }
    </section>
  `,
  styles: `header h1 { margin: 0; } .small { font-size: 0.8rem; }`,
})
export class AuditPage {
  readonly i18n = inject(I18nService);
  private readonly api = inject(ApiService);
  private readonly notify = inject(NotifyService);
  readonly page = signal<Page<AuditEvent> | null>(null);
  readonly verification = signal<{ valid: boolean; checked: number; brokenAtSeq?: number } | null>(null);
  action = '';
  constructor() {
    this.load(1);
  }
  load(page: number): void {
    this.api.get<Page<AuditEvent>>('/audit-events', { page, pageSize: 50, action: this.action.trim() }).subscribe({ next: (p) => this.page.set(p), error: (e) => this.notify.error(e) });
  }
  verify(): void {
    this.api.get<{ valid: boolean; checked: number; brokenAtSeq?: number }>('/audit-events/verify').subscribe({ next: (v) => this.verification.set(v), error: (e) => this.notify.error(e) });
  }
}
