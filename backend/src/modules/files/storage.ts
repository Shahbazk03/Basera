import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable } from '@nestjs/common';
import type { Response } from 'express';
import fs from 'node:fs/promises';
import { createReadStream, ReadStream } from 'node:fs';
import path from 'node:path';
import { env } from '../../config/env';
import { hmac, safeEqual } from '../../common/crypto';
import { PrismaService } from '../../prisma/prisma.service';

export type Visibility = 'PUBLIC' | 'PRIVATE';

/**
 * Short-lived link to a private file the API serves itself (local and database drivers):
 * /api/v1/files/<id>/download, signed with FILE_URL_SIGNING_SECRET.
 */
function signedDownloadUrl(fileId: string, ttlSeconds: number): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = hmac(`${fileId}.${exp}`, env().FILE_URL_SIGNING_SECRET);
  return `/api/v1/files/${fileId}/download?exp=${exp}&sig=${sig}`;
}

export function verifyDownloadSignature(fileId: string, exp: number, sig: string): boolean {
  if (!Number.isFinite(exp) || exp < Date.now() / 1000) return false;
  return safeEqual(sig, hmac(`${fileId}.${exp}`, env().FILE_URL_SIGNING_SECRET));
}

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
    return signedDownloadUrl(fileId, ttlSeconds);
  }

  verifySignature(fileId: string, exp: number, sig: string): boolean {
    return verifyDownloadSignature(fileId, exp, sig);
  }

  stream(key: string, visibility: Visibility): ReadStream {
    const target = path.join(this.root(visibility), key);
    if (!target.startsWith(this.root(visibility))) throw new Error('Invalid storage key');
    return createReadStream(target);
  }
}

/** One MongoDB document holds at most 16 MB: bigger files are stored in parts. */
const PART_BYTES = 4 * 1024 * 1024;
/** Keys made by the upload service: <purpose>/<yyyy>/<mm>/<uuid>.<ext> */
const STORAGE_KEY = /^[a-z-]+\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.[a-z]{3,4}$/;

/**
 * Files kept inside the MongoDB database itself — no separate storage service (on Atlas's free tier the
 * 512 MB is shared by data and files). Public files are served by the API at /uploads/<key>, the same
 * addresses as the local driver; private ones only through short-lived signed links.
 */
@Injectable()
export class DatabaseStorageDriver implements StorageDriver {
  readonly name = 'database';

  constructor(private readonly prisma: PrismaService) {}

  async put(key: string, body: Buffer, mimeType: string, visibility: Visibility): Promise<void> {
    const parts = [];
    for (let offset = 0, part = 0; part === 0 || offset < body.length; offset += PART_BYTES, part++) {
      parts.push({ storageKey: key, visibility, mimeType, part, data: new Uint8Array(body.subarray(offset, offset + PART_BYTES)) });
    }
    try {
      await this.prisma.storedFileChunk.createMany({ data: parts });
    } catch (e) {
      await this.prisma.storedFileChunk.deleteMany({ where: { storageKey: key } }).catch(() => undefined);
      throw e;
    }
  }

  publicUrl(key: string): string {
    return `/uploads/${key}`;
  }

  async signedUrl(fileId: string, _key: string, _fileName: string, ttlSeconds: number): Promise<string> {
    return signedDownloadUrl(fileId, ttlSeconds);
  }

  /** The stored file, or null when there is none with this key and visibility. */
  async read(key: string, visibility: Visibility): Promise<{ body: Buffer; mimeType: string } | null> {
    const parts = await this.prisma.storedFileChunk.findMany({ where: { storageKey: key, visibility }, orderBy: { part: 'asc' } });
    if (!parts.length || parts.some((p, i) => p.part !== i)) return null;
    return { body: Buffer.concat(parts.map((p) => p.data)), mimeType: parts[0].mimeType };
  }

  /** Answers GET/HEAD /uploads/<key> with a public file (registered in bootstrap.ts). */
  async servePublic(requestPath: string, res: Response): Promise<void> {
    const key = requestPath.replace(/^\/+/, '');
    const file = STORAGE_KEY.test(key) ? await this.read(key, 'PUBLIC') : null;
    if (!file) {
      res.status(404).end();
      return;
    }
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Length', String(file.body.length));
    // A key never gets other content, so browsers and the image optimiser may keep it.
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(file.body); // Node sends no body for HEAD requests
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
