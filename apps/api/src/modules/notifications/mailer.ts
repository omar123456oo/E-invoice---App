import { logger } from '../../common/logging/logger.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/**
 * Development/test mailer. Messages are kept in memory (for tests) and only
 * a non-sensitive summary is logged. Not permitted in production; an SMTP or
 * provider-backed implementation must be configured there.
 */
export class MemoryMailer implements Mailer {
  readonly outbox: MailMessage[] = [];
  async send(message: MailMessage): Promise<void> {
    if (process.env.NODE_ENV === 'production') throw new Error('MemoryMailer must not be used in production');
    this.outbox.push(message);
    logger.info({ to: message.to, subject: message.subject }, 'Email queued (memory mailer)');
  }
}

let mailer: Mailer = new MemoryMailer();
export const getMailer = (): Mailer => mailer;
export const setMailer = (m: Mailer): void => {
  mailer = m;
};
