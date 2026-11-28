import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  IStorageStrategy,
  OrphanS3KeyRecord,
  StorageUploadResult,
} from './strategies/storage.strategy.interface';
import { S3StorageStrategy } from './strategies/s3-storage.strategy';
import { LocalDiskStorageStrategy } from './strategies/local-disk-storage.strategy';

export type { OrphanS3KeyRecord, IStorageStrategy, StorageUploadResult };

/**
 * Storage Facade / Strategy Context.
 * Coordinates AWS S3 (`S3StorageStrategy`) as primary cloud storage and
 * Local Disk (`LocalDiskStorageStrategy`) as seamless dev/demo & outage fallback.
 * Maintains 100% backward-compatible public API for StopsService and ReportsService.
 */
@Injectable()
export class S3Service {
  private readonly logger = new Logger(S3Service.name);
  private readonly s3Strategy: S3StorageStrategy;
  private readonly localStrategy: LocalDiskStorageStrategy;

  constructor(
    @Optional() s3Strategy?: S3StorageStrategy,
    @Optional() localStrategy?: LocalDiskStorageStrategy,
  ) {
    this.s3Strategy = s3Strategy ?? new S3StorageStrategy();
    this.localStrategy = localStrategy ?? new LocalDiskStorageStrategy();
  }

  private resolveStrategyForKey(key: string): IStorageStrategy {
    return this.localStrategy.canHandleKey(key) ? this.localStrategy : this.s3Strategy;
  }

  /**
   * Upload file từ RAM Buffer lên AWS S3 Private Bucket (kèm Local Disk Fallback an toàn).
   * Trả về Object Key an toàn (ví dụ: 'pod/pod-1731640000-uuid.jpg' hoặc '/uploads/pod/<uuid>.jpg').
   * Extension được quyết định từ format ảnh đã xác thực bởi Sharp.
   */
  async uploadFile(
    file: Express.Multer.File,
    folder = 'pod',
    verifiedFormat = 'jpg',
  ): Promise<StorageUploadResult> {
    const safeExt = verifiedFormat.toLowerCase() === 'jpeg' ? 'jpg' : verifiedFormat.toLowerCase();

    if (!this.s3Strategy.isAvailableForUpload()) {
      return this.localStrategy.uploadFile(file, folder, safeExt);
    }

    try {
      return await this.s3Strategy.uploadFile(file, folder, safeExt);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[S3_UPLOAD_FALLBACK] Upload AWS S3 thất bại (${message}) -> Chuyển sang ${this.localStrategy.name}`,
      );
      return this.localStrategy.uploadFile(file, folder, safeExt);
    }
  }

  /**
   * Sinh Presigned GET URL có thời hạn để Web/Mobile truy cập ảnh an toàn.
   * Hỗ trợ tương thích ngược với các đường dẫn cũ (/uploads/pod/... hoặc http...).
   */
  async getPresignedUrl(key?: string | null, expiresIn?: number): Promise<string | null> {
    if (!key) return null;
    return this.resolveStrategyForKey(key).getUrl(key, expiresIn);
  }

  /**
   * Kiểm tra object có tồn tại trong storage tương ứng hay không.
   */
  async doesObjectExist(key: string): Promise<boolean> {
    return this.resolveStrategyForKey(key).doesObjectExist(key);
  }

  /**
   * Xóa file khỏi storage khi DB Transaction thất bại (kèm retry & dead-letter log cho S3).
   */
  async deleteFileWithRetry(key?: string | null, maxRetries = 3): Promise<void> {
    if (!key) return;
    await this.resolveStrategyForKey(key).deleteFile(key, maxRetries);
  }
}
