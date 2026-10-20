import nodemailer, { type Transporter } from 'nodemailer';
import { z } from 'zod';
import type { Mailer, MailMessage } from './mailer.js';

// nodemailer parses `to` as an address list, so CR/LF, commas or display names could add recipients.
const SingleAddress = z.email().max(254);

/** SMTP mailer (nodemailer). Use a TLS URL (smtps:// or STARTTLS) in production. */
export class SmtpMailer implements Mailer {
  private readonly transport: Transporter;
  constructor(url: string, private readonly from: string) {
    this.transport = nodemailer.createTransport(url);
  }
  async send(message: MailMessage): Promise<void> {
    if (!SingleAddress.safeParse(message.to).success) throw new Error('Mail recipient must be exactly one email address');
    await this.transport.sendMail({ from: this.from, to: message.to, subject: message.subject, text: message.text });
  }
}
