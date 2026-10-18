import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { ApiService } from '../../core/api/api.service';
import type { EtaStatusInfo } from '../../core/api/models';
import { AuthService } from '../../core/auth/auth.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { NotifyService } from '../../core/notify.service';
import { EtaStamp } from '../../shared/eta-stamp';
import { LocalDatePipe } from '../../shared/money.pipe';

@Component({
  selector: 'app-eta-status',
  imports: [MatButtonModule, EtaStamp, LocalDatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="row"><h1>{{ i18n.t('eta.title') }}</h1><span class="spacer"></span>
      @if (auth.can('eta:manage')) { <button mat-flat-button class="btn-primary" [disabled]="busy()" (click)="process()">{{ i18n.t('eta.process') }}</button> }
    </header>
    @if (info(); as s) {
      @if (s.warnings.length) {
        <section class="warn" role="alert">
          <h2>{{ i18n.t('eta.warnings') }}</h2>
          <ul>@for (w of s.warnings; track w) { <li>{{ w }}</li> }</ul>
        </section>
      }
      <section class="panel">
        <dl>
          <dt>{{ i18n.t('eta.environment') }}</dt><dd>{{ s.environment }} ({{ s.configuredEnvironment }})</dd>
          <dt>{{ i18n.t('eta.signing') }}</dt><dd>{{ s.signingMode }}</dd>
          <dt>{{ i18n.t('company.onboarding') }}</dt><dd>{{ s.onboarding.onboardingStatus }}</dd>
          <dt>{{ i18n.t('company.submission') }}</dt><dd>{{ s.onboarding.submissionEnabled ? i18n.t('common.yes') : i18n.t('common.no') }}</dd>
        </dl>
      </section>
      <section class="panel">
        <h2>{{ i18n.t('eta.byStatus') }}</h2>
        <table class="data"><tbody>
          @for (r of s.receiptsByStatus; track r.status) { <tr><td><app-eta-stamp [status]="r.status" /></td><td class="num end">{{ r.count }}</td><td class="muted">{{ r.oldestSince | localDate }}</td></tr> }
        </tbody></table>
      </section>
      <section class="panel">
        <h2>{{ i18n.t('eta.submissions') }}</h2>
        <table class="data"><tbody>
          @for (x of s.recentSubmissions; track x._id) { <tr><td>{{ x.sentAt | localDate }}</td><td>{{ x.status }}</td><td class="num">{{ x.httpStatus }}</td><td class="num">{{ x.acceptedCount }} / {{ x.rejectedCount }}</td><td class="muted">{{ x.errorCode }}</td></tr> }
        </tbody></table>
      </section>
    } @else { <p class="muted">{{ i18n.t('common.loading') }}</p> }
  `,
  styles: `
    header h1 { margin: 0; } section { margin-bottom: 16px; }
    .warn { border: 2px solid var(--pending); background: #fbf3e1; border-radius: var(--radius-m); padding: 12px 18px; }
    .warn h2 { color: var(--pending); margin-bottom: 4px; } .warn ul { margin: 0; }
    dl { display: grid; grid-template-columns: max-content 1fr; gap: 6px 20px; margin: 0; } dt { color: var(--muted); } dd { margin: 0; }
  `,
})
export class EtaStatusPage {
  readonly i18n = inject(I18nService);
  readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);
  private readonly notify = inject(NotifyService);
  readonly info = signal<EtaStatusInfo | null>(null);
  readonly busy = signal(false);
  constructor() {
    this.load();
  }
  load(): void {
    this.api.get<EtaStatusInfo>('/eta/status').subscribe({ next: (s) => this.info.set(s), error: (e) => this.notify.error(e) });
  }
  process(): void {
    this.busy.set(true);
    this.api.post<{ devicesSubmitted: number; submissionsPolled: number; receiptsReconciled: number }>('/eta/process').subscribe({
      next: (r) => {
        this.busy.set(false);
        this.notify.success(this.i18n.t('eta.processed', { d: r.devicesSubmitted, p: r.submissionsPolled, r: r.receiptsReconciled }));
        this.load();
      },
      error: (e) => {
        this.busy.set(false);
        this.notify.error(e);
      },
    });
  }
}
