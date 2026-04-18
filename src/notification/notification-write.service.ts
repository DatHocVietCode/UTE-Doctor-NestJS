import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Notification, NotificationDocument } from './schemas/notification.schema';

@Injectable()
export class NotificationWriteService {
  constructor(
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<NotificationDocument>,
  ) {}

  async storeIfNotExists(notification: Partial<NotificationDocument>): Promise<boolean> {
    try {
      const newNoti = new this.notificationModel(notification);
      await newNoti.save();
      return true;
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        return false;
      }

      throw error;
    }
  }
}
