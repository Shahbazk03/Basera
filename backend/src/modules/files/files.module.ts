import { Global, Module } from '@nestjs/common';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { LocalStorageDriver, S3StorageDriver } from './storage';

@Global()
@Module({
  controllers: [FilesController],
  providers: [FilesService, LocalStorageDriver, S3StorageDriver],
  exports: [FilesService],
})
export class FilesModule {}
