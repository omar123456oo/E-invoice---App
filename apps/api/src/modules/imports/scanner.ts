import { Socket } from 'node:net';

export interface ScanResult {
  status: 'CLEAN' | 'INFECTED' | 'NOT_SCANNED' | 'ERROR';
  detail: string | null;
}

export interface MalwareScanner {
  scan(data: Buffer): Promise<ScanResult>;
}

/** Used when no scanner is configured. Uploads are marked NOT_SCANNED and the UI shows it. */
export class NoScanner implements MalwareScanner {
  async scan(): Promise<ScanResult> {
    return { status: 'NOT_SCANNED', detail: 'No malware scanner configured' };
  }
}

/** ClamAV clamd INSTREAM protocol over TCP. */
export class ClamdScanner implements MalwareScanner {
  constructor(private readonly host: string, private readonly port: number, private readonly timeoutMs = 15_000) {}

  scan(data: Buffer): Promise<ScanResult> {
    return new Promise((resolvePromise) => {
      const socket = new Socket();
      let reply = '';
      const done = (r: ScanResult) => {
        socket.destroy();
        resolvePromise(r);
      };
      socket.setTimeout(this.timeoutMs, () => done({ status: 'ERROR', detail: 'Scanner timeout' }));
      socket.on('error', (e) => done({ status: 'ERROR', detail: e.message }));
      socket.on('data', (d) => (reply += d.toString('utf8')));
      socket.on('end', () => {
        const text = reply.replace(/\0/g, '').trim();
        if (/: OK$/.test(text)) done({ status: 'CLEAN', detail: null });
        else if (/FOUND$/.test(text)) done({ status: 'INFECTED', detail: text.replace(/^stream: /, '') });
        else done({ status: 'ERROR', detail: text || 'Empty scanner reply' });
      });
      socket.connect(this.port, this.host, () => {
        socket.write('zINSTREAM\0');
        for (let i = 0; i < data.length; i += 64 * 1024) {
          const chunk = data.subarray(i, i + 64 * 1024);
          const len = Buffer.alloc(4);
          len.writeUInt32BE(chunk.length);
          socket.write(len);
          socket.write(chunk);
        }
        socket.write(Buffer.alloc(4));
      });
    });
  }
}
