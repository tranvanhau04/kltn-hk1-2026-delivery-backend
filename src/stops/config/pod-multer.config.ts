import { BadRequestException } from '@nestjs/common';
import { memoryStorage } from 'multer';

export const podMulterOptions = {
  storage: memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max in RAM
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
