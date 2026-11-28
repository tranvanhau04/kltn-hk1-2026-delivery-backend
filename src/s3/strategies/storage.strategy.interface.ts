export interface StorageUploadResult {
  key: string;
}

export interface OrphanS3KeyRecord {
  key: string;
  bucket: string;
  timestamp: string;
  error: string;
  requestId?: string;
}

/**
 * Strategy contract for binary asset storage (Proof-of-Delivery images, etc.).
 * Allows seamlessly switching between cloud object storage (AWS S3)
 * and local filesystem storage without coupling callers to provider details.
 */
export interface IStorageStrategy {
  readonly name: string;

  /** Returns true if this strategy owns/can resolve the given storage key */
  canHandleKey(key: string): boolean;

  /** Persists the uploaded file buffer and returns the stored key */
  uploadFile(
    file: Express.Multer.File,
    folder: string,
    safeExt: string,
  ): Promise<StorageUploadResult>;

  /** Returns an accessible URL (presigned or local static path) for the stored key */
  getUrl(key: string, expiresIn?: number): Promise<string | null>;

  /** Checks whether the object exists in the underlying storage backend */
  doesObjectExist(key: string): Promise<boolean>;

  /** Deletes the stored file (used for compensating cleanup on DB transaction failure) */
  deleteFile(key: string, maxRetries?: number): Promise<void>;
}
