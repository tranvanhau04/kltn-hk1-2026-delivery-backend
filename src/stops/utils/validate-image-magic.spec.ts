import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { validateImageMagicBytes } from './validate-image-magic';

describe('validateImageMagicBytes', () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'magic-bytes-test-'));
  });

  afterAll(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  it('should accept valid JPEG header', async () => {
    const testFile = path.join(tmpDir, 'test.jpg');
    // JPEG starts with FF D8 FF
    const content = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
    await fs.promises.writeFile(testFile, content);

    const isValid = await validateImageMagicBytes(testFile);
    expect(isValid).toBe(true);
  });

  it('should accept valid PNG header', async () => {
    const testFile = path.join(tmpDir, 'test.png');
    // PNG starts with 89 50 4E 47 0D 0A 1A 0A
    const content = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
    await fs.promises.writeFile(testFile, content);

    const isValid = await validateImageMagicBytes(testFile);
    expect(isValid).toBe(true);
  });

  it('should accept valid WebP header', async () => {
    const testFile = path.join(tmpDir, 'test.webp');
    // WebP starts with RIFF (52 49 46 46), 4 bytes length, WEBP (57 45 42 50)
    const content = Buffer.from([
      0x52, 0x49, 0x46, 0x46, // RIFF
      0x24, 0x00, 0x00, 0x00, // file size
      0x57, 0x45, 0x42, 0x50, // WEBP
    ]);
    await fs.promises.writeFile(testFile, content);

    const isValid = await validateImageMagicBytes(testFile);
    expect(isValid).toBe(true);
  });

  it('should reject text file disguised as jpg', async () => {
    const testFile = path.join(tmpDir, 'fake.jpg');
    await fs.promises.writeFile(testFile, 'Hello world this is not an image at all!');

    const isValid = await validateImageMagicBytes(testFile);
    expect(isValid).toBe(false);
  });

  it('should reject empty file (0 bytes)', async () => {
    const testFile = path.join(tmpDir, 'empty.jpg');
    await fs.promises.writeFile(testFile, Buffer.alloc(0));

    const isValid = await validateImageMagicBytes(testFile);
    expect(isValid).toBe(false);
  });

  it('should reject file with only 2 bytes', async () => {
    const testFile = path.join(tmpDir, 'tiny.jpg');
    await fs.promises.writeFile(testFile, Buffer.from([0xff, 0xd8]));

    const isValid = await validateImageMagicBytes(testFile);
    expect(isValid).toBe(false);
  });

  it('should reject executable file disguised as png', async () => {
    const testFile = path.join(tmpDir, 'fake_exe.png');
    // MZ header for Windows PE
    const content = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00]);
    await fs.promises.writeFile(testFile, content);

    const isValid = await validateImageMagicBytes(testFile);
    expect(isValid).toBe(false);
  });
});
