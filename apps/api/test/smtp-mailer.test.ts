import { createServer, type AddressInfo, type Server, type Socket } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SmtpMailer } from '../src/modules/notifications/smtp-mailer.js';

/** Minimal SMTP server (no TLS, no auth) that records each envelope and raw message. */
interface Received { from: string; to: string[]; data: string }
const received: Received[] = [];
let server: Server;
let url: string;

function session(socket: Socket): void {
  let current: Received = { from: '', to: [], data: '' };
  let inData = false;
  let buffer = '';
  socket.write('220 test ESMTP\r\n');
  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    for (;;) {
      if (inData) {
        const end = buffer.indexOf('\r\n.\r\n');
        if (end === -1) return;
        current.data = buffer.slice(0, end);
        buffer = buffer.slice(end + 5);
        inData = false;
        received.push(current);
        current = { from: '', to: [], data: '' };
        socket.write('250 OK queued\r\n');
        continue;
      }
      const nl = buffer.indexOf('\r\n');
      if (nl === -1) return;
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 2);
      const cmd = line.slice(0, 4).toUpperCase();
      if (cmd === 'EHLO' || cmd === 'HELO') socket.write('250-test\r\n250 8BITMIME\r\n');
      else if (cmd === 'MAIL') {
        current.from = line;
        socket.write('250 OK\r\n');
      } else if (cmd === 'RCPT') {
        current.to.push(line);
        socket.write('250 OK\r\n');
      } else if (cmd === 'DATA') {
        inData = true;
        socket.write('354 go ahead\r\n');
      }
      else if (cmd === 'QUIT') socket.end('221 bye\r\n');
      else socket.write('250 OK\r\n');
    }
  });
}

beforeAll(async () => {
  server = createServer(session);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `smtp://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('SmtpMailer', () => {
  it('delivers a plain-text message with the configured sender over SMTP', async () => {
    received.length = 0;
    const mailer = new SmtpMailer(url, 'E-Receipt <noreply@example.test>');
    await mailer.send({ to: 'owner@example.test', subject: 'Receipt rejected', text: 'إيصال مرفوض\nReceipt R-1 was rejected.' });

    expect(received).toHaveLength(1);
    const [m] = received;
    expect(m!.from).toContain('<noreply@example.test>');
    expect(m!.to).toEqual([expect.stringContaining('<owner@example.test>')]);
    expect(m!.data).toMatch(/^Subject: Receipt rejected$/m);
    expect(m!.data).toMatch(/^To: owner@example\.test$/m);
    expect(m!.data).toMatch(/^From: "?E-Receipt"? <noreply@example\.test>$/m);
    // Arabic body survives the transfer encoding.
    const body = m!.data.split('\r\n\r\n').slice(1).join('\r\n\r\n');
    const decoded = /quoted-printable/i.test(m!.data)
      ? Buffer.from(body.replace(/=\r\n/g, '').replace(/=([0-9A-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16))), 'latin1').toString('utf8')
      : /base64/i.test(m!.data) ? Buffer.from(body, 'base64').toString('utf8') : body;
    expect(decoded).toContain('إيصال مرفوض');
  });

  it('refuses a recipient that is not exactly one address, so CR/LF or lists cannot add recipients', async () => {
    received.length = 0;
    const mailer = new SmtpMailer(url, 'noreply@example.test');
    for (const to of ['owner@example.test\r\nBcc: attacker@evil.test', 'owner@example.test, attacker@evil.test', 'Owner <owner@example.test>', '']) {
      await expect(mailer.send({ to, subject: 'Hi', text: 'x' })).rejects.toThrow(/recipient/i);
    }
    expect(received).toHaveLength(0);
  });

  it('keeps CR/LF in the subject from injecting headers', async () => {
    received.length = 0;
    const mailer = new SmtpMailer(url, 'noreply@example.test');
    await mailer.send({ to: 'owner@example.test', subject: 'Hi\r\nBcc: attacker@evil.test', text: 'x' });
    expect(received).toHaveLength(1);
    expect(received[0]!.to.join(' ')).not.toContain('evil.test');
    expect(received[0]!.data).not.toMatch(/^Bcc:/im);
  });
});
