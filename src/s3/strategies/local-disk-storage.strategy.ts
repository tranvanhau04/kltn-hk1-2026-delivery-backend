import { Injectable, Logger } from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { IStorageStrategy, StorageUploadResult } from './storage.strategy.interface';

/**
 * Local Disk Storage Strategy.
 * Persists validated POD images under `./uploads/<folder>/<filename>` for dev/demo
 * environments or when AWS S3 is unreachable.
 */
@Injectable()
export class LocalDiskStorageStrategy implements IStorageStrategy {
  readonly name = 'LocalDiskStorageStrategy';
  private readonly logger = new Logger(LocalDiskStorageStrategy.name);

  canHandleKey(key: string): boolean {
    return key.startsWith('/uploads/') || key.startsWith('http://') || key.startsWith('https://');
  }

  async uploadFile(
    file: Express.Multer.File,
    folder: string,
    safeExt: string,
  ): Promise<StorageUploadResult> {
    const filename = `pod-${Date.now()}-${uuidv4()}.${safeExt}`;
    const uploadDir = path.join(process.cwd(), 'uploads', folder);
    await fs.promises.mkdir(uploadDir, { recursive: true });
    await fs.promises.writeFile(path.join(uploadDir, filename), file.buffer);
    const localKey = `/uploads/${folder}/${filename}`;
    this.logger.log(
      `[LOCAL_POD_SAVED] Đã lưu ảnh POD xuống ổ cứng local: ${localKey} (${file.size} bytes)`,
    );
    return { key: localKey };
  }

  getUrl(key: string): Promise<string | null> {
    return Promise.resolve(key);
  }

  doesObjectExist(key: string): Promise<boolean> {
    if (!key.startsWith('/uploads/')) {
      return Promise.resolve(false);
    }
    const relativePath = key.replace(/^\/uploads\//, '');
    const fullPath = path.join(process.cwd(), 'uploads', relativePath);
    return Promise.resolve(fs.existsSync(fullPath));
  }

  deleteFile(key: string): Promise<void> {
    // Preserve backward-compatible no-op behavior for legacy /uploads/ paths
    if (key.startsWith('/uploads/')) {
      return Promise.resolve();
    }
    return Promise.resolve();
  }
}
