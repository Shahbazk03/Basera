import { Body, Controller, ForbiddenException, Get, Param, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { z } from 'zod';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, OptionalUser, Public } from '../../common/decorators';
import { UuidParam, ZodPipe } from '../../common/zod.pipe';
import { FilesService, UPLOAD_PURPOSES, UploadPurpose } from './files.service';

const uploadBody = z.object({
  purpose: z.enum(Object.keys(UPLOAD_PURPOSES) as [UploadPurpose, ...UploadPurpose[]]),
  organizationId: z.uuid().optional(),
});

@ApiTags('Files')
@Controller({ path: 'files', version: '1' })
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Post()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' }, purpose: { type: 'string', enum: Object.keys(UPLOAD_PURPOSES) }, organizationId: { type: 'string' } } } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 16 * 1024 * 1024, files: 1 } }))
  upload(@CurrentUser() user: AuthUser, @UploadedFile() file: Express.Multer.File | undefined, @Body(new ZodPipe(uploadBody)) body: z.output<typeof uploadBody>) {
    return this.files.upload(user, file, body.purpose, body.organizationId ?? null);
  }

  /** Short-lived URL for a document the caller is authorised to see. */
  @Public()
  @Get(':id/url')
  url(@OptionalUser() user: AuthUser | undefined, @Param('id', UuidParam) id: string) {
    return this.files.downloadUrl(user, id);
  }

  /** Signed download link (local storage driver only). */
  @Public()
  @Get(':id/download')
  async download(@Param('id', UuidParam) id: string, @Query(new ZodPipe(z.object({ exp: z.coerce.number().int(), sig: z.string().min(10).max(200) }))) q: { exp: number; sig: string }, @Res() res: Response) {
    if (this.files.driverName !== 'local' || !this.files.local.verifySignature(id, q.exp, q.sig)) throw new ForbiddenException('This link is invalid or has expired');
    const file = await this.files.getForDownload(id);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Disposition', `${file.mimeType === 'application/pdf' || file.mimeType.startsWith('image/') ? 'inline' : 'attachment'}; filename="${file.fileName.replace(/"/g, '')}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    this.files.local.stream(file.storageKey, file.visibility).on('error', () => res.status(404).end()).pipe(res);
  }
}
