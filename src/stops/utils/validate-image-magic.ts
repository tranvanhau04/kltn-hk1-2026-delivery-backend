import * as fs from 'fs';
import sharp from 'sharp';

interface MagicSignature {
  ext: string;
  bytes: number[];
  extra?: {
    offset: number;
    bytes: number[];
  };
}

const MAGIC_SIGNATURES: MagicSignature[] = [
  { ext: 'jpeg', bytes: [0xff, 0xd8, 0xff] },
  { ext: 'png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  {
    ext: 'webp',
    bytes: [0x52, 0x49, 0x46, 0x46], // RIFF
    extra: { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] }, // WEBP
  },
];

const MIN_BYTES_REQUIRED = 12;
const MAX_DIMENSION_PX = 6000;
const MAX_TOTAL_PIXELS = 25_000_000; // 25 Megapixels (Chống decompression bomb)

export interface ImageValidationResult {
  isValid: boolean;
  format?: 'jpeg' | 'png' | 'webp';
  width?: number;
  height?: number;
  errorMessage?: string;
}

function checkMagicBytes(buf: Buffer, length: number): boolean {
  if (length < 3) return false;

  return MAGIC_SIGNATURES.some((sig) => {
    if (length < sig.bytes.length) return false;
    const mainMatch = sig.bytes.every((b, i) => buf[i] === b);
    if (!mainMatch) return false;

    if (sig.extra) {
      const requiredLen = sig.extra.offset + sig.extra.bytes.length;
      if (length < requiredLen) return false;
      return sig.extra.bytes.every((b, i) => buf[sig.extra!.offset + i] === b);
    }

    return true;
  });
}

/**
 * 2.4: Kiểm tra tính toàn vẹn và an toàn của ảnh đa tầng:
 * 1. Kiểm tra Magic Bytes nhị phân (Pre-filter nhanh).
 * 2. Decode cấu trúc ảnh thực tế bằng Sharp (Format, Corrupted data, Zip/Pixel Bomb).
 * 3. Trả về format thực tế đã được chứng thực (không phụ thuộc vào extension do client gửi).
 */
export async function validateImageDetailed(
  input: Buffer | string,
): Promise<ImageValidationResult> {
  let buffer: Buffer;

  if (Buffer.isBuffer(input)) {
    buffer = input;
  } else {
    try {
      buffer = await fs.promises.readFile(input);
    } catch {
      return { isValid: false, errorMessage: 'Không thể đọc file ảnh từ đường dẫn đã cho.' };
    }
  }

  // Tầng 1: Magic Bytes Guard
  if (!checkMagicBytes(buffer, buffer.length)) {
    return {
      isValid: false,
      errorMessage:
        'File không khớp với Magic Bytes của ảnh hợp lệ (chỉ chấp nhận JPEG, PNG, WEBP).',
    };
  }

  // Tầng 2: Sharp Deep Decode & Security Guard
  try {
    const metadata = await sharp(buffer, { failOn: 'truncated' }).metadata();

    if (!metadata.format || !['jpeg', 'png', 'webp'].includes(metadata.format)) {
      return {
        isValid: false,
        errorMessage: `Định dạng ảnh '${metadata.format}' không được hỗ trợ. Chỉ chấp nhận JPEG, PNG, WEBP.`,
      };
    }

    const width = metadata.width || 0;
    const height = metadata.height || 0;

    if (width < 10 || height < 10) {
      return {
        isValid: false,
        errorMessage: 'Kích thước ảnh quá nhỏ (chiều dài và rộng phải tối thiểu 10px).',
      };
    }

    if (width > MAX_DIMENSION_PX || height > MAX_DIMENSION_PX) {
      return {
        isValid: false,
        errorMessage: `Kích thước ảnh vượt quá giới hạn an toàn (${MAX_DIMENSION_PX}px).`,
      };
    }

    if (width * height > MAX_TOTAL_PIXELS) {
      return {
        isValid: false,
        errorMessage: 'Tổng số pixel ảnh quá lớn, tiềm ẩn nguy cơ cạn kiệt tài nguyên bộ nhớ.',
      };
    }

    return {
      isValid: true,
      format: metadata.format as 'jpeg' | 'png' | 'webp',
      width,
      height,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isValid: false,
      errorMessage: `Dữ liệu ảnh bị lỗi hoặc không thể giải mã: ${message}`,
    };
  }
}

/**
 * Hàm kiểm tra nhanh Magic Bytes nhị phân (tương thích ngược)
 */
export async function validateImageMagicBytes(input: Buffer | string): Promise<boolean> {
  let buffer: Buffer;
  if (Buffer.isBuffer(input)) {
    buffer = input;
  } else {
    try {
      const fd = await fs.promises.open(input, 'r');
      try {
        const buf = Buffer.alloc(MIN_BYTES_REQUIRED);
        const { bytesRead } = await fd.read(buf, 0, MIN_BYTES_REQUIRED, 0);
        return checkMagicBytes(buf, bytesRead);
      } finally {
        await fd.close();
      }
    } catch {
      return false;
    }
  }
  return checkMagicBytes(buffer, buffer.length);
}
