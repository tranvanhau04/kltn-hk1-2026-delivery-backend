import { Global, Module } from '@nestjs/common';
import { S3Service } from './s3.service';
import { S3StorageStrategy } from './strategies/s3-storage.strategy';
import { LocalDiskStorageStrategy } from './strategies/local-disk-storage.strategy';

@Global()
@Module({
  providers: [S3StorageStrategy, LocalDiskStorageStrategy, S3Service],
  exports: [S3Service, S3StorageStrategy, LocalDiskStorageStrategy],
})
export class S3Module {}
