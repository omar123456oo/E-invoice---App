import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';

/** Sends each role to its most useful first screen. */
@Component({ selector: 'app-home-redirect', template: '', changeDetection: ChangeDetectionStrategy.OnPush })
export class HomeRedirect {
  constructor() {
    const auth = inject(AuthService);
    const target = auth.can('reports:read') ? '/dashboard' : auth.can('sales:checkout') ? '/pos' : auth.can('eta:read') ? '/eta' : auth.can('receipts:read') ? '/receipts' : '/login';
    void inject(Router).navigateByUrl(target, { replaceUrl: true });
  }
}
