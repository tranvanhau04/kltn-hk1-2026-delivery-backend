/**
 * Script Migration: Chuyển đổi dữ liệu ảnh POD từ Local Disk sang AWS S3
 *
 * Tiêu chuẩn an toàn doanh nghiệp (Enterprise Safe & Idempotent):
 * 1. Idempotent: Có thể chạy lại nhiều lần mà không bao giờ gây trùng lặp dữ liệu.
 * 2. Xác thực 2 đầu: Kiểm tra file local tồn tại -> Upload S3 -> HeadObject kiểm tra S3 -> Cập nhật DB.
 * 3. Không xóa file local: Giữ nguyên file local làm bản sao lưu an toàn (backup).
 * 4. Chi tiết logging: Báo cáo đầy đủ từng bản ghi được migrate, skip, hoặc lỗi.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  S3ClientConfig,
} from '@aws-sdk/client-s3';

// Load biến môi trường từ file .env
dotenv.config();

const S3_REGION = process.env.S3_REGION || 'ap-southeast-1';
const S3_BUCKET_NAME = process.env.S3_BUCKET_NAME || 'smartexpress-pod';
const S3_ACCESS_KEY_ID = process.env.S3_ACCESS_KEY_ID;
const S3_SECRET_ACCESS_KEY = process.env.S3_SECRET_ACCESS_KEY;

const DB_HOST = process.env.DB_HOST || '127.0.0.1';
const DB_PORT = parseInt(process.env.DB_PORT || '3308', 10);
const DB_USER = process.env.DB_USER || 'root';
const DB_PASSWORD = process.env.DB_PASSWORD || 'sapassword';
const DB_NAME = process.env.DB_NAME || 'delivery_db';

const LOCAL_POD_DIR = path.join(process.cwd(), 'uploads', 'pod');

async function runMigration() {
  console.log('='.repeat(70));
  console.log('🚀 BẮT ĐẦU MIGRATION ẢNH POD SANG AWS S3 OBJECT STORAGE');
  console.log('='.repeat(70));
  console.log(`- Database: ${DB_USER}@${DB_HOST}:${DB_PORT}/${DB_NAME}`);
  console.log(`- AWS S3 Bucket: ${S3_BUCKET_NAME} (Region: ${S3_REGION})`);
  console.log(`- Local POD Dir: ${LOCAL_POD_DIR}`);
  console.log('-'.repeat(70));

  // 1. Khởi tạo AWS S3 Client
  const clientConfig: S3ClientConfig = { region: S3_REGION };
  if (
    S3_ACCESS_KEY_ID &&
    S3_SECRET_ACCESS_KEY &&
    S3_ACCESS_KEY_ID !== 'your_access_key' &&
    S3_ACCESS_KEY_ID !== 'YOUR_AWS_ACCESS_KEY_ID'
  ) {
    clientConfig.credentials = {
      accessKeyId: S3_ACCESS_KEY_ID,
      secretAccessKey: S3_SECRET_ACCESS_KEY,
    };
  }

  const s3Client = new S3Client(clientConfig);

  // 2. Kết nối MySQL
  let dbConnection: mysql.Connection | null = null;
  try {
    dbConnection = await mysql.createConnection({
      host: DB_HOST,
      port: DB_PORT,
      user: DB_USER,
      password: DB_PASSWORD,
      database: DB_NAME,
    });
    console.log('✅ Đã kết nối Database thành công.');
  } catch (err: any) {
    console.error('❌ Lỗi kết nối Database:', err.message);
    process.exit(1);
  }

  try {
    // 3. Đọc danh sách proof_of_deliveries có photo_url
    const [rows] = await dbConnection.execute(
      'SELECT id, stop_id, photo_url FROM proof_of_deliveries WHERE photo_url IS NOT NULL',
    );
    const podRecords = rows as Array<{ id: string; stop_id: string; photo_url: string }>;

    console.log(`📦 Tìm thấy tổng cộng ${podRecords.length} bản ghi POD.`);

    let migratedCount = 0;
    let skippedCount = 0;
    let missingLocalCount = 0;
    let errorCount = 0;

    for (const record of podRecords) {
      const { id, photo_url } = record;

      // 4. Kiểm tra Idempotent: Nếu đã là Object Key S3 (vd: pod/pod-xxx.jpg)
      if (photo_url.startsWith('pod/') && !photo_url.includes('http') && !photo_url.includes('/uploads/')) {
        console.log(`⏭️  [SKIP] ID ${id}: Đã là S3 Object Key ('${photo_url}'). Bỏ qua.`);
        skippedCount++;
        continue;
      }

      // 5. Trích xuất tên file local
      let filename = '';
      if (photo_url.includes('/uploads/pod/')) {
        filename = photo_url.split('/uploads/pod/')[1];
      } else {
        filename = path.basename(photo_url);
      }

      if (!filename) {
        console.warn(`⚠️  [WARN] ID ${id}: Không thể parse tên file từ photo_url: '${photo_url}'`);
        errorCount++;
        continue;
      }

      const localFilePath = path.join(LOCAL_POD_DIR, filename);

      // 6. Kiểm tra file local tồn tại
      if (!fs.existsSync(localFilePath)) {
        console.warn(`⚠️  [MISSING LOCAL] ID ${id}: Không tìm thấy file trên đĩa tại: ${localFilePath}`);
        missingLocalCount++;
        continue;
      }

      const targetS3Key = `pod/${filename}`;
      const fileBuffer = fs.readFileSync(localFilePath);
      const ext = path.extname(filename).toLowerCase();
      const contentType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';

      try {
        // 7. Kiểm tra xem file đã tồn tại trên S3 chưa (tránh re-upload không cần thiết)
        let alreadyOnS3 = false;
        try {
          await s3Client.send(
            new HeadObjectCommand({
              Bucket: S3_BUCKET_NAME,
              Key: targetS3Key,
            }),
          );
          alreadyOnS3 = true;
        } catch {
          alreadyOnS3 = false;
        }

        if (!alreadyOnS3) {
          // Upload lên AWS S3
          await s3Client.send(
            new PutObjectCommand({
              Bucket: S3_BUCKET_NAME,
              Key: targetS3Key,
              Body: fileBuffer,
              ContentType: contentType,
            }),
          );

          // Xác nhận upload thành công
          await s3Client.send(
            new HeadObjectCommand({
              Bucket: S3_BUCKET_NAME,
              Key: targetS3Key,
            }),
          );
        }

        // 8. Cập nhật Database sang Object Key mới
        await dbConnection.execute(
          'UPDATE proof_of_deliveries SET photo_url = ? WHERE id = ?',
          [targetS3Key, id],
        );

        console.log(`✅ [MIGRATED] ID ${id}: '${filename}' -> '${targetS3Key}' (${alreadyOnS3 ? 'reused S3 object' : 'uploaded to S3'})`);
        migratedCount++;
      } catch (uploadErr: any) {
        console.error(`❌ [ERROR] ID ${id}: Lỗi khi upload hoặc update DB:`, uploadErr.message);
        errorCount++;
      }
    }

    // 9. Báo cáo kết quả
    console.log('='.repeat(70));
    console.log('📊 TỔNG KẾT MIGRATION:');
    console.log(`- Tổng số bản ghi POD:       ${podRecords.length}`);
    console.log(`- Đã migrate thành công:      ${migratedCount}`);
    console.log(`- Đã bỏ qua (Đã migrate rồi): ${skippedCount}`);
    console.log(`- File local bị thiếu:        ${missingLocalCount}`);
    console.log(`- Gặp lỗi:                    ${errorCount}`);
    console.log('='.repeat(70));
    console.log('ℹ️  File ảnh cục bộ trong uploads/pod/ được GIỮ NGUYÊN làm bản sao lưu an toàn.');
    console.log('='.repeat(70));
  } finally {
    if (dbConnection) {
      await dbConnection.end();
    }
  }
}

runMigration().catch((err) => {
  console.error('Fatal error during migration:', err);
  process.exit(1);
});
