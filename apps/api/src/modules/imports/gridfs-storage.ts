import mongoose from 'mongoose';
import type { FileStorage } from './storage.js';

/**
 * Stores uploads in MongoDB GridFS (bucket "uploads"). Used on serverless hosts
 * where the local filesystem is temporary. Access is only through the API,
 * which checks permissions and tenant ownership before reading a key.
 */
export class GridFsStorage implements FileStorage {
  private bucket(): mongoose.mongo.GridFSBucket {
    const db = mongoose.connection.db;
    if (!db) throw new Error('MongoDB is not connected');
    return new mongoose.mongo.GridFSBucket(db, { bucketName: 'uploads' });
  }

  async put(key: string, data: Buffer): Promise<void> {
    const bucket = this.bucket();
    const existing = await bucket.find({ filename: key }).limit(1).toArray();
    if (existing.length) return; // content-addressed key: same key = same bytes
    await new Promise<void>((resolve, reject) => {
      const stream = bucket.openUploadStream(key);
      stream.once('finish', () => resolve());
      stream.once('error', reject);
      stream.end(data);
    });
  }

  async get(key: string): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of this.bucket().openDownloadStreamByName(key)) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
  }
}
