import { Global, Module } from '@nestjs/common';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { DatabaseStorageDriver, LocalStorageDriver, S3StorageDriver } from './storage';

@Global()
@Module({
  controllers: [FilesController],
  providers: [FilesService, LocalStorageDriver, S3StorageDriver, DatabaseStorageDriver],
  exports: [FilesService],
})
export class FilesModule {}
