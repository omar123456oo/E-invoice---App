import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import type { ApiErrorBody } from './api/models';
import { I18nService } from './i18n/i18n.service';

/** User-facing messages, including a consistent translation of API errors. */
@Injectable({ providedIn: 'root' })
export class NotifyService {
  private readonly snack = inject(MatSnackBar);
  private readonly i18n = inject(I18nService);

  success(message: string): void {
    this.snack.open(message, this.i18n.t('common.close'), { duration: 3500, politeness: 'polite' });
  }

  warn(message: string): void {
    this.snack.open(message, this.i18n.t('common.close'), { duration: 6000, politeness: 'assertive' });
  }

  error(err: unknown): void {
    this.snack.open(this.describe(err), this.i18n.t('common.close'), { duration: 8000, politeness: 'assertive', panelClass: 'snack-error' });
  }

  describe(err: unknown): string {
    if (err instanceof HttpErrorResponse) {
      if (err.status === 0) return this.i18n.t('error.network');
      const body = err.error as ApiErrorBody | null;
      if (body?.error) {
        const detail = body.error.details?.map((d) => d.message).filter(Boolean).slice(0, 3).join('; ');
        return detail && body.error.code === 'VALIDATION_FAILED' ? detail : body.error.message;
      }
      if (err.status === 403) return this.i18n.t('error.forbidden');
    }
    return this.i18n.t('error.generic', { id: '—' });
  }
}
