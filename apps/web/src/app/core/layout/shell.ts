import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { AuthService } from '../auth/auth.service';
import { I18nService } from '../i18n/i18n.service';

interface NavItem { path: string; label: string; permission: string }

const NAV: NavItem[] = [
  { path: '/dashboard', label: 'nav.dashboard', permission: 'reports:read' },
  { path: '/pos', label: 'nav.pos', permission: 'sales:checkout' },
  { path: '/receipts', label: 'nav.receipts', permission: 'receipts:read' },
  { path: '/returns', label: 'nav.returns', permission: 'returns:read' },
  { path: '/shifts', label: 'nav.shifts', permission: 'payments:read' },
  { path: '/products', label: 'nav.products', permission: 'products:read' },
  { path: '/settings/tax', label: 'nav.tax', permission: 'tax:read' },
  { path: '/settings/devices', label: 'nav.devices', permission: 'pos:devices:read' },
  { path: '/settings/company', label: 'nav.company', permission: 'company:read' },
  { path: '/eta', label: 'nav.eta', permission: 'eta:read' },
  { path: '/admin/users', label: 'nav.users', permission: 'users:read' },
  { path: '/admin/audit', label: 'nav.audit', permission: 'audit:read' },
];

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, MatButtonModule, MatMenuModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="shell">
      <aside class="rail no-print">
        <div class="brand">{{ i18n.t('app.name') }}</div>
        <nav [attr.aria-label]="i18n.t('app.name')">
          @for (item of items(); track item.path) {
            <a [routerLink]="item.path" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: false }">{{ i18n.t(item.label) }}</a>
          }
        </nav>
        <div class="spacer"></div>
        <div class="who">
          <div class="name">{{ auth.me()?.user?.name }}</div>
          <div class="role">{{ i18n.t('role.' + auth.me()?.user?.role) }}</div>
          <div class="row">
            <button mat-button class="light" (click)="i18n.toggle()">{{ i18n.t('common.language') }}</button>
            <button mat-button class="light" (click)="auth.logout()">{{ i18n.t('common.signOut') }}</button>
          </div>
        </div>
      </aside>
      <main class="content"><router-outlet /></main>
    </div>
  `,
  styles: `
    .shell { display: grid; grid-template-columns: 232px 1fr; min-height: 100vh; }
    .rail { background: var(--ink); color: #dfeceb; display: flex; flex-direction: column; padding: 20px 12px; position: sticky; top: 0; height: 100vh; overflow-y: auto; }
    .brand { font-size: 1.4rem; font-weight: 700; color: #fff; padding: 4px 12px 20px; }
    nav { display: flex; flex-direction: column; gap: 2px; }
    nav a { color: #c9dedd; text-decoration: none; padding: 9px 12px; border-radius: var(--radius-s); border-inline-start: 3px solid transparent; }
    nav a:hover { background: rgba(255,255,255,0.06); color: #fff; }
    nav a.active { background: rgba(255,255,255,0.1); color: #fff; border-inline-start-color: var(--brass); font-weight: 600; }
    .who { border-top: 1px solid rgba(255,255,255,0.15); padding: 14px 12px 0; }
    .who .name { color: #fff; font-weight: 600; }
    .who .role { font-size: 0.85rem; color: #a9c4c2; margin-bottom: 6px; }
    .light { --mat-button-text-label-text-color: #ffffff; --mat-button-text-state-layer-color: #ffffff; color: #fff; }
    .content { padding: 28px 32px; min-width: 0; }
    @media (max-width: 900px) {
      .shell { grid-template-columns: 1fr; }
      .rail { position: static; height: auto; }
      nav { flex-direction: row; flex-wrap: wrap; }
      .content { padding: 16px; }
    }
    @media print { .shell { display: block; } .content { padding: 0; } }
  `,
})
export class Shell {
  readonly auth = inject(AuthService);
  readonly i18n = inject(I18nService);
  readonly items = computed(() => NAV.filter((n) => this.auth.permissions().has(n.permission)));
}
