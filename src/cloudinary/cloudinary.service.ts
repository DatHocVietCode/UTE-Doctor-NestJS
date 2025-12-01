import { Injectable, Logger } from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';

@Injectable()
export class CloudinaryService {
  private readonly logger = new Logger(CloudinaryService.name);

  constructor() {
    // Cloudinary configuration from env vars
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });
  }

  async uploadBase64(base64String: string, folder?: string): Promise<string> {
    try {
      const options: any = {};
      if (folder) options.folder = folder;
      const result = await cloudinary.uploader.upload(base64String, options);
      this.logger.log(`Uploaded to Cloudinary: ${result.secure_url}`);
      return result.secure_url;
    } catch (error) {
      this.logger.error('Cloudinary upload failed', error as any);
      throw error;
    }
  }

  async uploadFileBuffer(fileBuffer: Buffer, mimetype: string, folder?: string): Promise<string> {
    const dataUri = `data:${mimetype};base64,${fileBuffer.toString('base64')}`;
    return this.uploadBase64(dataUri, folder);
  }
}
