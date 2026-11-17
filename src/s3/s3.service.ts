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

export interface OrphanS3KeyRecord {
  key: string;
  bucket: string;
  timestamp: string;
  error: string;
  requestId?: string;
}

@Injectable()
export class S3Service {
  private readonly logger = new Logger(S3Service.name);
  private readonly s3Client: S3Client;
  private readonly bucketName: string;
  private readonly region: string;
  private readonly presignedExpiresIn: number;
  private readonly orphanLogPath = path.join(process.cwd(), 'logs', 'orphan-s3-keys.json');

  constructor() {
    this.region = process.env.S3_REGION || 'ap-southeast-1';
    this.bucketName = process.env.S3_BUCKET_NAME || 'smartexpress-pod';
    this.presignedExpiresIn = parseInt(process.env.S3_PRESIGNED_EXPIRES_IN || '3600', 10);

    const clientConfig: S3ClientConfig = {
      region: this.region,
    };

    // AWS SDK v3 Default Credential Provider Chain:
    // 1. Nếu có AccessKey & SecretKey trong .env (Local dev) -> Sử dụng IAM User credentials.
    // 2. Nếu KHÔNG có (Production trên EC2 / ECS / EKS) -> Tự động nhận diện IAM Role.
    const accessKeyId = process.env.S3_ACCESS_KEY_ID;
    const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
    if (
      accessKeyId &&
      secretAccessKey &&
      accessKeyId !== 'your_access_key' &&
      accessKeyId !== 'YOUR_AWS_ACCESS_KEY_ID'
    ) {
      clientConfig.credentials = {
        accessKeyId,
        secretAccessKey,
      };
      this.logger.log(`S3Service: Sử dụng IAM User credentials từ môi trường`);
    } else {
      this.logger.log(`S3Service: Sử dụng AWS IAM Role / Default Credential Provider Chain`);
    }

    this.s3Client = new S3Client(clientConfig);
    this.logger.log(
      `S3Client khởi tạo thành công - AWS Region: ${this.region}, Bucket: ${this.bucketName}`,
    );
  }

  /**
   * Upload file từ RAM Buffer lên AWS S3 Private Bucket
   * Trả về Object Key an toàn (ví dụ: 'pod/pod-1731640000-uuid.jpg')
   * Extension được quyết định từ format ảnh đã xác thực bởi Sharp.
   */
  async uploadFile(
    file: Express.Multer.File,
    folder = 'pod',
    verifiedFormat = 'jpg',
  ): Promise<{ key: string }> {
    const safeExt = verifiedFormat.toLowerCase() === 'jpeg' ? 'jpg' : verifiedFormat.toLowerCase();
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

  /**
   * Sinh Presigned GET URL có thời hạn để Web/Mobile truy cập ảnh an toàn
   * Hỗ trợ tương thích ngược với các đường dẫn cũ (/uploads/pod/... hoặc http...)
   */
  async getPresignedUrl(key?: string | null, expiresIn?: number): Promise<string | null> {
    if (!key) return null;

    // Tương thích ngược: nếu là link http(s) hoặc đường dẫn local cũ, trả về nguyên bản
    if (key.startsWith('http://') || key.startsWith('https://') || key.startsWith('/uploads/')) {
      return key;
    }

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

  /**
   * Kiểm tra object có tồn tại trên S3 hay không
   */
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

  /**
   * Xóa file khỏi S3 khi DB Transaction thất bại
   * - Giới hạn tối đa 3 lần thử
   * - Exponential backoff (300ms, 600ms, 1200ms)
   * - Không ghi secret key, presigned url vào log
   * - Ghi nhận orphan object vào dead-letter file để đối soát định kỳ
   */
  async deleteFileWithRetry(key?: string | null, maxRetries = 3): Promise<void> {
    if (!key) return;

    // Bỏ qua nếu là đường dẫn local cũ
    if (key.startsWith('/uploads/')) return;

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

  /**
   * Ghi nhận các object rác không xóa được vào logs/orphan-s3-keys.json
   */
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
