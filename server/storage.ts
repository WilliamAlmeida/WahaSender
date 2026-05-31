import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Readable } from 'stream';
import { S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { fileTypeFromBuffer } from 'file-type';
import { config } from './config';
import { logger } from './logger';

export interface UploadInput {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

export interface UploadResult {
  filename: string;
  url: string;
  mimetype: string;
  size: number;
}

const ALLOWED_MIME = new Set<string>([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'video/mp4',
  'video/webm',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'audio/x-m4a',
  'audio/mp4',
  'application/pdf',
]);

const ALLOWED_EXT = new Set<string>([
  '.jpg', '.jpeg', '.png', '.gif', '.webp',
  '.mp4', '.webm',
  '.mp3', '.ogg', '.wav', '.m4a',
  '.pdf',
]);

export class UploadValidationError extends Error {
  status = 400;
}

export async function validateUpload(file: UploadInput): Promise<{ mime: string; ext: string }> {
  if (!file?.buffer || file.size <= 0) {
    throw new UploadValidationError('Empty file');
  }
  if (file.size > config.UPLOAD_MAX_BYTES) {
    throw new UploadValidationError(`File exceeds maximum size of ${config.UPLOAD_MAX_BYTES} bytes`);
  }

  const ext = path.extname(file.originalname || '').toLowerCase();
  if (!ALLOWED_EXT.has(ext)) {
    throw new UploadValidationError(`File extension "${ext}" not allowed`);
  }

  const detected = await fileTypeFromBuffer(file.buffer);
  const detectedMime = detected?.mime || file.mimetype;
  if (!ALLOWED_MIME.has(detectedMime)) {
    throw new UploadValidationError(`MIME type "${detectedMime}" not allowed`);
  }
  // Cross-check declared vs detected if both known
  if (detected && file.mimetype && !file.mimetype.startsWith('application/octet-stream')) {
    if (detected.mime !== file.mimetype) {
      logger.warn(
        { declared: file.mimetype, detected: detected.mime, name: file.originalname },
        '[Upload] Declared MIME mismatched detected; using detected',
      );
    }
  }
  return { mime: detectedMime, ext };
}

interface IStorageProvider {
  uploadFile(file: UploadInput, userId: string): Promise<UploadResult>;
  /** For local provider only: returns a readable stream + meta if file is owned by user. */
  serveLocal?(userId: string, filename: string): { stream: Readable; mimetype?: string } | null;
}

class LocalStorageProvider implements IStorageProvider {
  private rootDir: string;

  constructor() {
    this.rootDir = path.resolve(process.cwd(), 'storage', 'uploads');
    fs.mkdirSync(this.rootDir, { recursive: true });
  }

  private userDir(userId: string): string {
    const dir = path.join(this.rootDir, userId);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  async uploadFile(file: UploadInput, userId: string): Promise<UploadResult> {
    const { mime } = await validateUpload(file);
    const fileHash = crypto.randomBytes(8).toString('hex');
    const clean = (file.originalname || 'file').replace(/[^a-zA-Z0-9.-]/g, '_').slice(-80);
    const filename = `${Date.now()}-${fileHash}-${clean}`;
    const dest = path.join(this.userDir(userId), filename);
    fs.writeFileSync(dest, file.buffer);
    return {
      filename,
      url: `/api/uploads/${encodeURIComponent(filename)}`,
      mimetype: mime,
      size: file.size,
    };
  }

  serveLocal(userId: string, filename: string) {
    // Prevent path traversal
    const safe = path.basename(filename);
    const full = path.join(this.userDir(userId), safe);
    if (!fs.existsSync(full)) return null;
    return { stream: fs.createReadStream(full) };
  }
}

class S3StorageProvider implements IStorageProvider {
  private s3: S3Client;
  private bucket: string;
  private region: string;
  private endpoint?: string;

  constructor() {
    this.region = config.AWS_REGION;
    this.bucket = config.AWS_BUCKET || '';
    this.endpoint = config.AWS_ENDPOINT;

    if (!this.bucket) {
      throw new Error('[Storage] STORAGE_TYPE=s3 but AWS_BUCKET is empty');
    }

    const clientConfig: any = {
      region: this.region,
      credentials: config.AWS_ACCESS_KEY_ID
        ? {
            accessKeyId: config.AWS_ACCESS_KEY_ID,
            secretAccessKey: config.AWS_SECRET_ACCESS_KEY || '',
          }
        : undefined,
    };
    if (this.endpoint) {
      clientConfig.endpoint = this.endpoint;
      clientConfig.forcePathStyle = true;
    }
    this.s3 = new S3Client(clientConfig);
  }

  async uploadFile(file: UploadInput, userId: string): Promise<UploadResult> {
    const { mime } = await validateUpload(file);
    const fileHash = crypto.randomBytes(8).toString('hex');
    const clean = (file.originalname || 'file').replace(/[^a-zA-Z0-9.-]/g, '_').slice(-80);
    const key = `${userId}/${Date.now()}-${fileHash}-${clean}`;

    const stream = Readable.from(file.buffer);
    const uploader = new Upload({
      client: this.s3,
      params: {
        Bucket: this.bucket,
        Key: key,
        Body: stream,
        ContentType: mime,
      },
    });
    await uploader.done();

    let fileUrl: string;
    if (this.endpoint) {
      fileUrl = `${this.endpoint.replace(/\/$/, '')}/${this.bucket}/${key}`;
    } else {
      fileUrl = `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;
    }
    return { filename: key, url: fileUrl, mimetype: mime, size: file.size };
  }
}

class StorageFactory {
  static build(): IStorageProvider {
    if (config.STORAGE_TYPE === 's3') {
      logger.info('[Storage] Using AWS S3 driver');
      return new S3StorageProvider();
    }
    logger.info('[Storage] Using local filesystem driver');
    return new LocalStorageProvider();
  }
}

export const storage = StorageFactory.build();
export default storage;
