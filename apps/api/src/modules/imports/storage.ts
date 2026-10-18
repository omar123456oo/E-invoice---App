import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

/** Private object storage. Local disk by default; swap for S3/Azure Blob behind the same interface. */
export interface FileStorage {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
}

const SAFE_KEY = /^[a-f0-9]{24}\/[a-f0-9]{64}\.[a-z0-9]{2,5}$/;

export class LocalFileStorage implements FileStorage {
  private readonly root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }
  private path(key: string): string {
    if (!SAFE_KEY.test(key)) throw new Error('Invalid storage key');
    const p = resolve(join(this.root, key));
    if (!p.startsWith(this.root + sep)) throw new Error('Invalid storage key');
    return p;
  }
  async put(key: string, data: Buffer): Promise<void> {
    const p = this.path(key);
    await mkdir(resolve(p, '..'), { recursive: true, mode: 0o700 });
    await writeFile(p, data, { mode: 0o600, flag: 'w' });
  }
  async get(key: string): Promise<Buffer> {
    return readFile(this.path(key));
  }
}
