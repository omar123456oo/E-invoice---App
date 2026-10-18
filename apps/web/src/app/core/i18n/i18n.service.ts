import { DOCUMENT } from '@angular/common';
import { Injectable, effect, inject, signal } from '@angular/core';
import { MESSAGES, type Lang, type MessageKey } from './messages';

const STORAGE_KEY = 'ereceipt.lang';

/** Runtime language switching with right-to-left support. Arabic is the default. */
@Injectable({ providedIn: 'root' })
export class I18nService {
  private readonly doc = inject(DOCUMENT);
  readonly lang = signal<Lang>(this.initial());

  constructor() {
    effect(() => {
      const lang = this.lang();
      const html = this.doc.documentElement;
      html.lang = lang;
      html.dir = lang === 'ar' ? 'rtl' : 'ltr';
      try {
        localStorage.setItem(STORAGE_KEY, lang);
      } catch {
        /* storage unavailable: language just isn't remembered */
      }
    });
  }

  private initial(): Lang {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      if (v === 'ar' || v === 'en') return v;
    } catch {
      /* ignore */
    }
    return 'ar';
  }

  toggle(): void {
    this.lang.update((l) => (l === 'ar' ? 'en' : 'ar'));
  }

  /** Reads the language signal, so templates re-render when the language changes. */
  t(key: MessageKey | string, params?: Record<string, string | number>): string {
    const table = MESSAGES[this.lang()] as Record<string, string>;
    let text = table[key] ?? (MESSAGES.en as Record<string, string>)[key] ?? key;
    if (params) for (const [k, v] of Object.entries(params)) text = text.replace(`{${k}}`, String(v));
    return text;
  }

  get locale(): string {
    return this.lang() === 'ar' ? 'ar-EG' : 'en-EG';
  }
}
