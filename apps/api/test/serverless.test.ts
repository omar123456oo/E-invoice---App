import { Types } from 'mongoose';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { resetEnvCache } from '../src/config/env.js';
import { GridFsStorage } from '../src/modules/imports/gridfs-storage.js';
import { useTestApp } from './helpers.js';

const t = useTestApp();

describe('serverless deployment support', () => {
  afterEach(() => {
    delete process.env.CRON_SECRET;
    resetEnvCache();
  });

  it('stores and reads uploads in GridFS (content-addressed, idempotent)', async () => {
    const storage = new GridFsStorage();
    const key = `${new Types.ObjectId().toHexString()}/${'a'.repeat(64)}.pdf`;
    const data = Buffer.from('%PDF-1.4 test content');
    await storage.put(key, data);
    await storage.put(key, data);
    expect((await storage.get(key)).equals(data)).toBe(true);
  });

  it('keeps the cron sweep closed without a secret and requires the exact bearer token', async () => {
    expect((await request(t.app).get('/api/v1/internal/cron/sweep')).status).toBe(404);
    process.env.CRON_SECRET = 'cron-secret-for-tests-0123456789';
    resetEnvCache();
    expect((await request(t.app).get('/api/v1/internal/cron/sweep').set('Authorization', 'Bearer wrong')).status).toBe(401);
    const ok = await request(t.app).get('/api/v1/internal/cron/sweep').set('Authorization', 'Bearer cron-secret-for-tests-0123456789');
    expect(ok.status).toBe(200);
    expect(ok.body.ok).toBe(true);
  });
});
