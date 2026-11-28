import { S3Service } from './s3.service';
import { S3StorageStrategy } from './strategies/s3-storage.strategy';
import { LocalDiskStorageStrategy } from './strategies/local-disk-storage.strategy';

describe('S3Service (Strategy Pattern)', () => {
  const mockFile = {
    buffer: Buffer.from('fake-image-bytes'),
    size: 16,
    originalname: 'pod.jpg',
    mimetype: 'image/jpeg',
  } as Express.Multer.File;

  it('delegates directly to LocalDiskStorageStrategy when S3 is unavailable for upload', async () => {
    const s3Upload = jest.fn();
    const localUpload = jest.fn().mockResolvedValue({ key: '/uploads/pod/pod-local.jpg' });

    const s3Strategy = {
      name: 'S3StorageStrategy',
      isAvailableForUpload: jest.fn().mockReturnValue(false),
      canHandleKey: jest.fn((k: string) => !k.startsWith('/uploads/')),
      uploadFile: s3Upload,
      getUrl: jest.fn(),
      doesObjectExist: jest.fn(),
      deleteFile: jest.fn(),
    } as unknown as S3StorageStrategy;

    const localStrategy = {
      name: 'LocalDiskStorageStrategy',
      canHandleKey: jest.fn((k: string) => k.startsWith('/uploads/')),
      uploadFile: localUpload,
      getUrl: jest.fn((k: string) => Promise.resolve(k)),
      doesObjectExist: jest.fn().mockResolvedValue(true),
      deleteFile: jest.fn().mockResolvedValue(undefined),
    } as unknown as LocalDiskStorageStrategy;

    const service = new S3Service(s3Strategy, localStrategy);
    const result = await service.uploadFile(mockFile, 'pod', 'jpeg');

    expect(result).toEqual({ key: '/uploads/pod/pod-local.jpg' });
    expect(s3Upload).not.toHaveBeenCalled();
    expect(localUpload).toHaveBeenCalledWith(mockFile, 'pod', 'jpg');
  });

  it('uses S3StorageStrategy when available and falls back to LocalDiskStorageStrategy on S3 failure', async () => {
    const s3Upload = jest.fn().mockRejectedValue(new Error('S3 AccessDenied'));
    const localUpload = jest.fn().mockResolvedValue({ key: '/uploads/pod/fallback.jpg' });

    const s3Strategy = {
      name: 'S3StorageStrategy',
      isAvailableForUpload: jest.fn().mockReturnValue(true),
      canHandleKey: jest.fn((k: string) => !k.startsWith('/uploads/')),
      uploadFile: s3Upload,
      getUrl: jest.fn().mockResolvedValue('https://s3.presigned/pod-1.jpg'),
      doesObjectExist: jest.fn().mockResolvedValue(true),
      deleteFile: jest.fn().mockResolvedValue(undefined),
    } as unknown as S3StorageStrategy;

    const localStrategy = {
      name: 'LocalDiskStorageStrategy',
      canHandleKey: jest.fn((k: string) => k.startsWith('/uploads/')),
      uploadFile: localUpload,
      getUrl: jest.fn((k: string) => Promise.resolve(k)),
      doesObjectExist: jest.fn().mockResolvedValue(true),
      deleteFile: jest.fn().mockResolvedValue(undefined),
    } as unknown as LocalDiskStorageStrategy;

    const service = new S3Service(s3Strategy, localStrategy);
    const result = await service.uploadFile(mockFile, 'pod', 'png');

    expect(result).toEqual({ key: '/uploads/pod/fallback.jpg' });
    expect(s3Upload).toHaveBeenCalledWith(mockFile, 'pod', 'png');
    expect(localUpload).toHaveBeenCalledWith(mockFile, 'pod', 'png');
  });

  it('routes getPresignedUrl and deleteFileWithRetry to the owning strategy by key prefix', async () => {
    const s3GetUrl = jest.fn().mockResolvedValue('https://signed.s3/key.jpg');
    const s3DeleteFile = jest.fn().mockResolvedValue(undefined);

    const s3Strategy = {
      name: 'S3StorageStrategy',
      isAvailableForUpload: jest.fn().mockReturnValue(true),
      canHandleKey: jest.fn((k: string) => !k.startsWith('/uploads/')),
      uploadFile: jest.fn(),
      getUrl: s3GetUrl,
      doesObjectExist: jest.fn().mockResolvedValue(true),
      deleteFile: s3DeleteFile,
    } as unknown as S3StorageStrategy;

    const localStrategy = new LocalDiskStorageStrategy();

    const service = new S3Service(s3Strategy, localStrategy);

    expect(await service.getPresignedUrl(null)).toBeNull();
    expect(await service.getPresignedUrl('/uploads/pod/a.jpg')).toBe('/uploads/pod/a.jpg');
    expect(await service.getPresignedUrl('https://cdn.example.com/a.jpg')).toBe(
      'https://cdn.example.com/a.jpg',
    );
    expect(await service.getPresignedUrl('pod/s3-key.jpg', 900)).toBe('https://signed.s3/key.jpg');
    expect(s3GetUrl).toHaveBeenCalledWith('pod/s3-key.jpg', 900);

    await service.deleteFileWithRetry('/uploads/pod/a.jpg');
    expect(s3DeleteFile).not.toHaveBeenCalled();

    await service.deleteFileWithRetry('pod/s3-key.jpg', 2);
    expect(s3DeleteFile).toHaveBeenCalledWith('pod/s3-key.jpg', 2);
  });
});
