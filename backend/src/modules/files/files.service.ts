import { BadRequestException, ForbiddenException, Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { env } from '../../config/env';
import { AuthUser } from '../../common/auth/auth-user';
import { PrismaService } from '../../prisma/prisma.service';
import { DatabaseStorageDriver, LocalStorageDriver, S3StorageDriver, StorageDriver, Visibility } from './storage';

/** Upload purposes, their visibility and accepted kinds. */
export const UPLOAD_PURPOSES = {
  'property-media': { visibility: 'PUBLIC', kinds: ['image'] },
  'project-media': { visibility: 'PUBLIC', kinds: ['image'] },
  'cms-media': { visibility: 'PUBLIC', kinds: ['image'] },
  avatar: { visibility: 'PUBLIC', kinds: ['image'] },
  'org-logo': { visibility: 'PUBLIC', kinds: ['image'] },
  'property-document': { visibility: 'PRIVATE', kinds: ['image', 'pdf'] },
  'project-document': { visibility: 'PRIVATE', kinds: ['image', 'pdf'] },
  'org-document': { visibility: 'PRIVATE', kinds: ['image', 'pdf'] },
  'employee-document': { visibility: 'PRIVATE', kinds: ['image', 'pdf'] },
  receipt: { visibility: 'PRIVATE', kinds: ['image', 'pdf'] },
  'lead-import': { visibility: 'PRIVATE', kinds: ['csv'] },
} as const satisfies Record<string, { visibility: Visibility; kinds: readonly ('image' | 'pdf' | 'csv')[] }>;
export type UploadPurpose = keyof typeof UPLOAD_PURPOSES;

const MAX_IMAGE_BYTES = 1 * 1024 * 1024;
const MAX_DOC_BYTES = 15 * 1024 * 1024;
const MAX_IMAGE_EDGE = 2560;
const AVATAR_EDGE = 512;

interface Detected {
  kind: 'image' | 'pdf' | 'csv';
  mime: string;
  ext: string;
}

/** Identifies the file from its magic bytes — the client-supplied MIME type is never trusted. */
export function detectFileType(buf: Buffer): Detected | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { kind: 'image', mime: 'image/jpeg', ext: 'jpg' };
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { kind: 'image', mime: 'image/png', ext: 'png' };
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return { kind: 'image', mime: 'image/webp', ext: 'webp' };
  if (buf.length >= 12 && buf.toString('ascii', 4, 8) === 'ftyp' && ['avif', 'avis'].includes(buf.toString('ascii', 8, 12))) return { kind: 'image', mime: 'image/avif', ext: 'avif' };
  if (buf.length >= 5 && buf.toString('ascii', 0, 5) === '%PDF-') return { kind: 'pdf', mime: 'application/pdf', ext: 'pdf' };
  // CSV: valid UTF-8 text without NUL bytes
  const sample = buf.subarray(0, 4096);
  if (!sample.includes(0) && /^[\x09\x0a\x0d\x20-\x7e -￿]*$/u.test(sample.toString('utf8'))) return { kind: 'csv', mime: 'text/csv', ext: 'csv' };
  return null;
}

@Injectable()
export class FilesService {
  private readonly driver: StorageDriver;

  constructor(
    private readonly prisma: PrismaService,
    readonly local: LocalStorageDriver,
    s3: S3StorageDriver,
    readonly database: DatabaseStorageDriver,
  ) {
    const configured = env().STORAGE_DRIVER;
    this.driver = configured === 's3' ? s3 : configured === 'database' ? database : local;
  }

  get driverName(): string {
    return this.driver.name;
  }

  async upload(user: AuthUser, file: Express.Multer.File | undefined, purpose: UploadPurpose, organizationId: string | null) {
    if (!file) throw new BadRequestException('Attach a file in the "file" field');
    const rule = UPLOAD_PURPOSES[purpose];
    const detected = detectFileType(file.buffer);
    if (!detected || !(rule.kinds as readonly string[]).includes(detected.kind)) {
      throw new BadRequestException({ message: `Unsupported file type. Allowed: ${rule.kinds.join(', ').replace('image', 'JPEG/PNG/WebP/AVIF images').replace('pdf', 'PDF')}`, code: 'UNSUPPORTED_FILE_TYPE' });
    }
    const limit = detected.kind === 'image' ? MAX_IMAGE_BYTES : MAX_DOC_BYTES;
    if (file.size > limit) throw new PayloadTooLargeException(`File exceeds ${Math.round(limit / 1024 / 1024)} MB`);
    if (organizationId && !user.isMemberOf(organizationId) && !user.hasGlobal('property.edit') && !user.hasGlobal('project.edit') && !user.hasGlobal('cms.manage')) {
      throw new ForbiddenException('You cannot upload files for this organisation');
    }

    let body = file.buffer;
    let mime = detected.mime;
    let ext = detected.ext;
    let width: number | null = null;
    let height: number | null = null;
    if (detected.kind === 'image') {
      // Re-encode: strips EXIF/GPS metadata, normalises orientation, bounds dimensions, defeats polyglot files.
      try {
        const base = sharp(file.buffer, { limitInputPixels: 80_000_000 }).rotate();
        // Profile photos are stored as a 512px square, cropped around the most salient region (usually the face).
        const sized =
          purpose === 'avatar'
            ? base.resize({ width: AVATAR_EDGE, height: AVATAR_EDGE, fit: 'cover', position: sharp.strategy.attention })
            : base.resize({ width: MAX_IMAGE_EDGE, height: MAX_IMAGE_EDGE, fit: 'inside', withoutEnlargement: true });
        const out = await sized.webp({ quality: 82 }).toBuffer({ resolveWithObject: true });
        body = out.data;
        width = out.info.width;
        height = out.info.height;
        mime = 'image/webp';
        ext = 'webp';
      } catch {
        throw new BadRequestException({ message: 'The image could not be processed — it may be corrupt', code: 'INVALID_IMAGE' });
      }
    }

    const now = new Date();
    const key = `${purpose}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}.${ext}`;
    await this.driver.put(key, body, mime, rule.visibility);
    const safeName = (file.originalname || `upload.${ext}`).replace(/[^\w.\- ]/g, '_').slice(0, 150);
    const row = await this.prisma.storedFile.create({
      data: {
        storageKey: key,
        visibility: rule.visibility,
        fileName: detected.kind === 'image' ? safeName.replace(/\.[^.]+$/, '.webp') : safeName,
        mimeType: mime,
        sizeBytes: body.length,
        checksumSha256: createHash('sha256').update(body).digest('hex'),
        width,
        height,
        purpose,
        uploadedById: user.id,
        organizationId,
      },
    });
    return {
      id: row.id,
      fileName: row.fileName,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      width,
      height,
      visibility: row.visibility,
      url: rule.visibility === 'PUBLIC' ? this.driver.publicUrl(key) : null,
    };
  }

  /** Public URL for a stored PUBLIC file (used when attaching uploads to listings). */
  async publicUrlFor(fileId: string, user: AuthUser): Promise<{ url: string; storageKey: string }> {
    const file = await this.prisma.storedFile.findUnique({ where: { id: fileId } });
    if (!file || file.deletedAt) throw new NotFoundException('File not found');
    if (file.visibility !== 'PUBLIC') throw new BadRequestException('Only public files can be used as media');
    if (file.uploadedById !== user.id && !(file.organizationId && user.isMemberOf(file.organizationId)) && !user.hasGlobal('property.edit') && !user.hasGlobal('project.edit')) {
      throw new ForbiddenException('You cannot use this file');
    }
    return { url: this.driver.publicUrl(file.storageKey), storageKey: file.storageKey };
  }

  /**
   * Issues a short-lived download URL for a private file after checking that the user may see the
   * record the file is attached to. Public files simply return their permanent URL.
   */
  async downloadUrl(user: AuthUser | undefined, fileId: string): Promise<{ url: string; expiresInSeconds: number | null; fileName: string }> {
    const file = await this.prisma.storedFile.findUnique({
      where: { id: fileId },
      include: {
        orgDocuments: { select: { organizationId: true } },
        propertyDocuments: { select: { visibility: true, property: { select: { organizationId: true } } } },
        projectDocuments: { select: { visibility: true, project: { select: { organizationId: true, developerOrgId: true, isPublished: true } } } },
        employeeDocuments: { select: { employee: { select: { userId: true, organizationId: true } } } },
        expenses: { select: { organizationId: true } },
        reimbursements: { select: { organizationId: true, employee: { select: { userId: true, manager: { select: { userId: true } } } } } },
      },
    });
    if (!file || file.deletedAt) throw new NotFoundException('File not found');
    if (file.visibility === 'PUBLIC') return { url: this.driver.publicUrl(file.storageKey), expiresInSeconds: null, fileName: file.fileName };

    const publiclyShared =
      file.propertyDocuments.some((d) => d.visibility === 'PUBLIC') || file.projectDocuments.some((d) => d.visibility === 'PUBLIC' && d.project.isPublished);
    const allowed =
      publiclyShared ||
      (user &&
        (file.uploadedById === user.id ||
          file.orgDocuments.some((d) => user.can('organization.manage', d.organizationId) || user.can('broker.verify', d.organizationId) || user.can('developer.verify', d.organizationId)) ||
          file.propertyDocuments.some((d) => user.can('property.edit', d.property.organizationId) || user.can('property.approve', d.property.organizationId)) ||
          file.projectDocuments.some((d) => user.can('project.edit', d.project.organizationId) || user.can('project.approve', d.project.organizationId)) ||
          file.employeeDocuments.some((d) => d.employee.userId === user.id || user.can('employee.manage', d.employee.organizationId)) ||
          file.expenses.some((e) => user.can('finance.view', e.organizationId)) ||
          // Claimant, the claimant's direct manager (who decides the claim) and finance.
          file.reimbursements.some((r) => r.employee.userId === user.id || r.employee.manager?.userId === user.id || user.can('finance.view', r.organizationId))));
    if (!allowed) throw new ForbiddenException('You do not have access to this document');
    const ttl = 300;
    return { url: await this.driver.signedUrl(file.id, file.storageKey, file.fileName, ttl), expiresInSeconds: ttl, fileName: file.fileName };
  }

  async getForDownload(fileId: string) {
    const file = await this.prisma.storedFile.findUnique({ where: { id: fileId } });
    if (!file || file.deletedAt) throw new NotFoundException('File not found');
    return file;
  }

  async readFileBuffer(fileId: string): Promise<Buffer> {
    const file = await this.getForDownload(fileId);
    if (this.driver === this.database) {
      const stored = await this.database.read(file.storageKey, file.visibility);
      if (!stored) throw new BadRequestException('File could not be read');
      return stored.body;
    }
    if (this.driver.name !== 'local') {
      const url = await this.driver.signedUrl(file.id, file.storageKey, file.fileName, 60);
      const res = await fetch(url);
      if (!res.ok) throw new BadRequestException('File could not be read');
      return Buffer.from(await res.arrayBuffer());
    }
    const chunks: Buffer[] = [];
    for await (const chunk of this.local.stream(file.storageKey, file.visibility)) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
  }
}
