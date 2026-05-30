import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import dotenv from 'dotenv';

dotenv.config();

export interface UploadResult {
  filename: string;
  url: string;
}

export interface IStorageProvider {
  uploadFile(file: Express.Multer.File): Promise<UploadResult>;
}

// 1. Provedor de Storage Local (Filesystem)
class LocalStorageProvider implements IStorageProvider {
  private uploadDir: string;

  constructor() {
    this.uploadDir = path.resolve(process.cwd(), 'storage', 'uploads');
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
  }

  async uploadFile(file: Express.Multer.File): Promise<UploadResult> {
    const fileHash = crypto.randomBytes(8).toString('hex');
    const cleanOriginalName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    const uniqueFilename = `${Date.now()}-${fileHash}-${cleanOriginalName}`;
    const destinationPath = path.join(this.uploadDir, uniqueFilename);

    fs.writeFileSync(destinationPath, file.buffer);

    // Retorna a URL relativa que será exposta como estática pelo express
    const fileUrl = `/uploads/${uniqueFilename}`;

    return {
      filename: uniqueFilename,
      url: fileUrl
    };
  }
}

// 2. Provedor de Storage AWS S3
class S3StorageProvider implements IStorageProvider {
  private s3Client: S3Client;
  private bucket: string;
  private region: string;

  constructor() {
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID || '';
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY || '';
    this.region = process.env.AWS_REGION || 'us-east-1';
    this.bucket = process.env.AWS_BUCKET || '';
    const endpoint = process.env.AWS_ENDPOINT || undefined;

    const clientConfig: any = {
      region: this.region,
      credentials: {
        accessKeyId,
        secretAccessKey
      }
    };

    // Caso utilize MinIO, Cloudflare R2 ou outro endpoint compatível com S3
    if (endpoint) {
      clientConfig.endpoint = endpoint;
      clientConfig.forcePathStyle = true; // Necessário para R2/MinIO em alguns casos
    }

    this.s3Client = new S3Client(clientConfig);
  }

  async uploadFile(file: Express.Multer.File): Promise<UploadResult> {
    if (!this.bucket) {
      throw new Error('S3 Storage ativo mas AWS_BUCKET não foi configurado no arquivo .env.');
    }

    const fileHash = crypto.randomBytes(8).toString('hex');
    const cleanOriginalName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    const uniqueFilename = `${Date.now()}-${fileHash}-${cleanOriginalName}`;

    const uploadParams = {
      Bucket: this.bucket,
      Key: uniqueFilename,
      Body: file.buffer,
      ContentType: file.mimetype,
    };

    await this.s3Client.send(new PutObjectCommand(uploadParams));

    // Monta a URL pública (usando endpoint customizado se houver)
    let fileUrl = '';
    const customEndpoint = process.env.AWS_ENDPOINT;
    if (customEndpoint) {
      // Formato para Cloudflare R2, MinIO ou custom
      fileUrl = `${customEndpoint.replace(/\/$/, '')}/${this.bucket}/${uniqueFilename}`;
    } else {
      // Formato clássico da AWS S3
      fileUrl = `https://${this.bucket}.s3.${this.region}.amazonaws.com/${uniqueFilename}`;
    }

    return {
      filename: uniqueFilename,
      url: fileUrl
    };
  }
}

// 3. Fábrica do StorageProvider
class StorageFactory {
  static getProvider(): IStorageProvider {
    const storageType = (process.env.STORAGE_TYPE || 'local').toLowerCase();

    if (storageType === 's3') {
      console.log('[Storage] Usando driver AWS S3 Storage.');
      return new S3StorageProvider();
    }

    console.log('[Storage] Usando driver Local Filesystem Storage.');
    return new LocalStorageProvider();
  }
}

export const storage = StorageFactory.getProvider();
export default storage;
