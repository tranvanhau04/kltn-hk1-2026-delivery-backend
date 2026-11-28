import { Injectable, Logger } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import {
  IStorageStrategy,
  OrphanS3KeyRecord,
  StorageUploadResult,
} from './storage.strategy.interface';

/**
 * AWS S3 Storage Strategy.
 * Handles private bucket uploads, time-limited presigned GET URLs,
 * existence checks, and retryable cleanup with dead-letter orphan tracking.
 */
@Injectable()
export class S3StorageStrategy implements IStorageStrategy {
  readonly name = 'S3StorageStrategy';
  private readonly logger = new Logger(S3StorageStrategy.name);
  private readonly s3Client: S3Client;
  private readonly bucketName: string;
  private readonly region: string;
  private readonly presignedExpiresIn: number;
  private readonly hasExplicitAwsCredentials: boolean;
  private readonly orphanLogPath = path.join(process.cwd(), 'logs', 'orphan-s3-keys.json');

  constructor() {
    this.region = process.env.S3_REGION || 'ap-southeast-1';
    this.bucketName = process.env.S3_BUCKET_NAME || 'smartexpress-pod';
    this.presignedExpiresIn = parseInt(process.env.S3_PRESIGNED_EXPIRES_IN || '3600', 10);

    const clientConfig: S3ClientConfig = {
      region: this.region,
    };

    const accessKeyId = process.env.S3_ACCESS_KEY_ID?.trim();
    const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY?.trim();
    if (
      accessKeyId &&
      secretAccessKey &&
      accessKeyId !== 'your_access_key' &&
      accessKeyId !== 'YOUR_AWS_ACCESS_KEY_ID'
    ) {
      this.hasExplicitAwsCredentials = true;
      clientConfig.credentials = {
        accessKeyId,
        secretAccessKey,
      };
      this.logger.log(`S3StorageStrategy: Sử dụng IAM User credentials từ môi trường`);
    } else {
      this.hasExplicitAwsCredentials = false;
      this.logger.log(
        `S3StorageStrategy: Không có IAM key tĩnh — ưu tiên Local Disk Fallback khi ở môi trường dev/demo`,
      );
    }

    this.s3Client = new S3Client(clientConfig);
    this.logger.log(
      `S3Client khởi tạo thành công - AWS Region: ${this.region}, Bucket: ${this.bucketName}`,
    );
  }

  /**
   * Determines whether AWS S3 should be attempted as the primary upload target.
   */
  isAvailableForUpload(): boolean {
    return this.hasExplicitAwsCredentials || process.env.NODE_ENV === 'production';
  }

  canHandleKey(key: string): boolean {
    return (
      !key.startsWith('/uploads/') && !key.startsWith('http://') && !key.startsWith('https://')
    );
  }

  async uploadFile(
    file: Express.Multer.File,
    folder: string,
    safeExt: string,
  ): Promise<StorageUploadResult> {
    const key = `${folder}/pod-${Date.now()}-${uuidv4()}.${safeExt}`;

    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      Body: file.buffer,
      ContentType: `image/${safeExt === 'jpg' ? 'jpeg' : safeExt}`,
    });

    const response = await this.s3Client.send(command);
    const requestId = response.$metadata?.requestId;

    this.logger.log(
      `[S3_UPLOAD_SUCCESS] Upload thành công key: ${key} (${file.size} bytes)${requestId ? ` [ReqID: ${requestId}]` : ''}`,
    );

    return { key };
  }

  async getUrl(key: string, expiresIn?: number): Promise<string | null> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      const ttl = expiresIn || this.presignedExpiresIn;
      return await getSignedUrl(this.s3Client, command, { expiresIn: ttl });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[S3_PRESIGNED_ERROR] Không thể sinh presigned URL cho key ${key}: ${message}`,
      );
      return null;
    }
  }

  async doesObjectExist(key: string): Promise<boolean> {
    try {
      await this.s3Client.send(
        new HeadObjectCommand({
          Bucket: this.bucketName,
          Key: key,
        }),
      );
      return true;
    } catch {
      return false;
    }
  }

  async deleteFile(key: string, maxRetries = 3): Promise<void> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const command = new DeleteObjectCommand({
          Bucket: this.bucketName,
          Key: key,
        });

        const response = await this.s3Client.send(command);
        const requestId = response.$metadata?.requestId;
        this.logger.log(
          `[S3_CLEANUP_SUCCESS] Đã xóa thành công object S3: ${key}${requestId ? ` [ReqID: ${requestId}]` : ''}`,
        );
        return;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `[S3_CLEANUP_RETRY] Lần ${attempt}/${maxRetries} xóa S3 object ${key} thất bại: ${message}`,
        );

        if (attempt === maxRetries) {
          this.logger.error(
            `[ORPHAN_S3_KEY] CẢNH BÁO NGUY CƠ FILE RÁC: Không thể xóa S3 object sau ${maxRetries} lần thử. Bucket: ${this.bucketName}, Key: ${key}. Lý do: ${message}`,
          );
          this.recordOrphanObject({
            key,
            bucket: this.bucketName,
            timestamp: new Date().toISOString(),
            error: message,
          });
        } else {
          const delay = 300 * Math.pow(2, attempt - 1);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }
  }

  private recordOrphanObject(record: OrphanS3KeyRecord) {
    try {
      const logsDir = path.dirname(this.orphanLogPath);
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }

      let records: OrphanS3KeyRecord[] = [];
      if (fs.existsSync(this.orphanLogPath)) {
        try {
          const content = fs.readFileSync(this.orphanLogPath, 'utf-8');
          records = JSON.parse(content) as OrphanS3KeyRecord[];
        } catch {
          records = [];
        }
      }

      records.push(record);
      fs.writeFileSync(this.orphanLogPath, JSON.stringify(records, null, 2), 'utf-8');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Không thể ghi file orphan log: ${message}`);
    }
  }
}
