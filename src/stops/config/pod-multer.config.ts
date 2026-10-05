import { BadRequestException } from '@nestjs/common';
import { diskStorage } from 'multer';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

export const POD_UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'pod');

export const podMulterOptions = {
  storage: diskStorage({
    destination: (req, file, cb) => {
      if (!fs.existsSync(POD_UPLOAD_DIR)) {
        fs.mkdirSync(POD_UPLOAD_DIR, { recursive: true });
      }
      cb(null, POD_UPLOAD_DIR);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
      const uniqueName = `pod-${Date.now()}-${uuidv4()}${ext}`;
      cb(null, uniqueName);
    },
  }),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max
  },
  fileFilter: (
    req: unknown,
    file: Express.Multer.File,
    cb: (error: Error | null, acceptFile: boolean) => void,
  ) => {
    const allowedMimes = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        new BadRequestException(
          'Định dạng ảnh không hợp lệ. Chỉ chấp nhận các file ảnh JPEG, PNG, WEBP.',
        ),
        false,
      );
    }
  },
};
