import * as fs from 'fs';

interface MagicSignature {
  ext: string;
  bytes: number[];
  extra?: {
    offset: number;
    bytes: number[];
  };
}

const MAGIC_SIGNATURES: MagicSignature[] = [
  { ext: 'jpg', bytes: [0xff, 0xd8, 0xff] },
  { ext: 'png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  {
    ext: 'webp',
    bytes: [0x52, 0x49, 0x46, 0x46], // RIFF
    extra: { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] }, // WEBP
  },
];

/** Minimum byte count needed: longest signature is WebP = 12 bytes */
const MIN_BYTES_REQUIRED = 12;

/**
 * Reads the first 12 bytes of a file and validates against known image magic signatures.
 * Returns true only if the file content matches JPEG, PNG, or WebP.
 */
export async function validateImageMagicBytes(filePath: string): Promise<boolean> {
  const fd = await fs.promises.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(MIN_BYTES_REQUIRED);
    const { bytesRead } = await fd.read(buf, 0, MIN_BYTES_REQUIRED, 0);

    // ── Guard: File quá nhỏ hoặc rỗng → chắc chắn không phải ảnh ──
    if (bytesRead < 3) return false; // Ngắn hơn cả signature nhỏ nhất (JPEG = 3 bytes)

    return MAGIC_SIGNATURES.some((sig) => {
      // Kiểm tra đủ bytes cho signature chính
      if (bytesRead < sig.bytes.length) return false;
      const mainMatch = sig.bytes.every((b, i) => buf[i] === b);
      if (!mainMatch) return false;

      // Kiểm tra extra bytes nếu có (WebP: offset 8-11)
      if (sig.extra) {
        const requiredLen = sig.extra.offset + sig.extra.bytes.length;
        if (bytesRead < requiredLen) return false;
        return sig.extra.bytes.every((b, i) => buf[sig.extra!.offset + i] === b);
      }

      return true;
    });
  } finally {
    await fd.close();
  }
}
