import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable } from '@nestjs/common';
import fs from 'node:fs/promises';
import { createReadStream, ReadStream } from 'node:fs';
import path from 'node:path';
import { env } from '../../config/env';
import { hmac, safeEqual } from '../../common/crypto';

export type Visibility = 'PUBLIC' | 'PRIVATE';

export interface StorageDriver {
  readonly name: string;
  put(key: string, body: Buffer, mimeType: string, visibility: Visibility): Promise<void>;
  /** Permanent URL for PUBLIC objects */
  publicUrl(key: string): string;
  /** Short-lived URL for PRIVATE objects */
  signedUrl(fileId: string, key: string, fileName: string, ttlSeconds: number): Promise<string>;
}

/** Development driver: files on disk; public files served at /uploads, private ones via HMAC-signed API links. */
@Injectable()
export class LocalStorageDriver implements StorageDriver {
  readonly name = 'local';

  private root(visibility: Visibility): string {
    return path.resolve(env().STORAGE_LOCAL_DIR, visibility === 'PUBLIC' ? 'public' : 'private');
  }

  async put(key: string, body: Buffer, _mime: string, visibility: Visibility): Promise<void> {
    const target = path.join(this.root(visibility), key);
    if (!target.startsWith(this.root(visibility))) throw new Error('Invalid storage key');
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, body);
  }

  publicUrl(key: string): string {
    return `/uploads/${key}`;
  }

  async signedUrl(fileId: string, _key: string, _fileName: string, ttlSeconds: number): Promise<string> {
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
    const sig = hmac(`${fileId}.${exp}`, env().FILE_URL_SIGNING_SECRET);
    return `/api/v1/files/${fileId}/download?exp=${exp}&sig=${sig}`;
  }

  verifySignature(fileId: string, exp: number, sig: string): boolean {
    if (!Number.isFinite(exp) || exp < Date.now() / 1000) return false;
    return safeEqual(sig, hmac(`${fileId}.${exp}`, env().FILE_URL_SIGNING_SECRET));
  }

  stream(key: string, visibility: Visibility): ReadStream {
    const target = path.join(this.root(visibility), key);
    if (!target.startsWith(this.root(visibility))) throw new Error('Invalid storage key');
    return createReadStream(target);
  }
}

/** S3-compatible object storage (AWS S3, Cloudflare R2, MinIO). Private objects use presigned GET URLs. */
@Injectable()
export class S3StorageDriver implements StorageDriver {
  readonly name = 's3';
  private client: S3Client | null = null;

  private s3(): S3Client {
    if (!this.client) {
      const e = env();
      if (!e.S3_BUCKET_PUBLIC || !e.S3_BUCKET_PRIVATE || !e.S3_ACCESS_KEY_ID || !e.S3_SECRET_ACCESS_KEY) {
        throw new Error('S3 storage is not configured (S3_BUCKET_PUBLIC, S3_BUCKET_PRIVATE, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY)');
      }
      this.client = new S3Client({
        region: e.S3_REGION ?? 'auto',
        endpoint: e.S3_ENDPOINT,
        forcePathStyle: e.S3_FORCE_PATH_STYLE,
        credentials: { accessKeyId: e.S3_ACCESS_KEY_ID, secretAccessKey: e.S3_SECRET_ACCESS_KEY },
      });
    }
    return this.client;
  }

  private bucket(visibility: Visibility): string {
    return visibility === 'PUBLIC' ? env().S3_BUCKET_PUBLIC! : env().S3_BUCKET_PRIVATE!;
  }

  async put(key: string, body: Buffer, mimeType: string, visibility: Visibility): Promise<void> {
    await this.s3().send(
      new PutObjectCommand({
        Bucket: this.bucket(visibility),
        Key: key,
        Body: body,
        ContentType: mimeType,
        CacheControl: visibility === 'PUBLIC' ? 'public, max-age=31536000, immutable' : 'private, no-store',
      }),
    );
  }

  publicUrl(key: string): string {
    const base = env().S3_PUBLIC_BASE_URL;
    if (!base) throw new Error('S3_PUBLIC_BASE_URL is required for public objects');
    return `${base.replace(/\/$/, '')}/${key}`;
  }

  async signedUrl(_fileId: string, key: string, fileName: string, ttlSeconds: number): Promise<string> {
    return getSignedUrl(
      this.s3(),
      new GetObjectCommand({
        Bucket: this.bucket('PRIVATE'),
        Key: key,
        ResponseContentDisposition: `attachment; filename="${fileName.replace(/[^\w.\- ]/g, '_')}"`,
      }),
      { expiresIn: ttlSeconds },
    );
  }
}
