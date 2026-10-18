import { Pipe, PipeTransform, inject } from '@angular/core';
import { I18nService } from '../core/i18n/i18n.service';
import { formatMoney } from './money';

/** Impure so that it re-formats when the language changes. Cheap: formatting only. */
@Pipe({ name: 'money', pure: false })
export class MoneyPipe implements PipeTransform {
  private readonly i18n = inject(I18nService);
  transform(value: string | null | undefined, currency = 'EGP'): string {
    return formatMoney(value, this.i18n.locale, currency);
  }
}

@Pipe({ name: 'localDate', pure: false })
export class LocalDatePipe implements PipeTransform {
  private readonly i18n = inject(I18nService);
  transform(value: string | Date | null | undefined, withTime = true): string {
    if (!value) return '—';
    return new Intl.DateTimeFormat(this.i18n.locale, {
      timeZone: 'Africa/Cairo', dateStyle: 'medium', ...(withTime ? { timeStyle: 'short' } : {}),
    }).format(new Date(value));
  }
}
