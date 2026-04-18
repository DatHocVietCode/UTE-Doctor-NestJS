import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PaginationQueryDto } from 'src/common/dto/pagination-query.dto';
import { PaginationResult } from 'src/common/dto/pagination-result.dto';
import type { NotificationPayload, NotificationType } from './dto/notification-payload.dto';
import { AppointmentCancelledNotificationHandler } from './handlers/appointment-cancelled-notification.handler';
import { AppointmentSuccessNotificationHandler } from './handlers/appointment-success-notification.handler';
import { CoinExpiryNotificationHandler } from './handlers/coin-expiry-notification.handler';
import { NotificationHandlerMeta } from './handlers/notification-handler.interface';
import type { HandlerRegistry } from './handlers/notification-handler.types';
import { PaymentSuccessNotificationHandler } from './handlers/payment-success-notification.handler';
import { Notification, NotificationDocument } from './schemas/notification.schema';

@Injectable()
export class NotificationService {
    private readonly logger = new Logger(NotificationService.name);
    private readonly handlers: HandlerRegistry;

    constructor(
        @InjectModel(Notification.name)
        private readonly notificationModel: Model<NotificationDocument>,
        private readonly coinExpiryHandler: CoinExpiryNotificationHandler,
        private readonly appointmentSuccessHandler: AppointmentSuccessNotificationHandler,
        private readonly appointmentCancelledHandler: AppointmentCancelledNotificationHandler,
        private readonly paymentSuccessHandler: PaymentSuccessNotificationHandler,
    ) {
        // Registry avoids switch-case branching and keeps each type handler isolated.
        this.handlers = {
            COIN_EXPIRY_REMINDER: this.coinExpiryHandler,
            APPOINTMENT_SUCCESS: this.appointmentSuccessHandler,
            APPOINTMENT_CANCELLED: this.appointmentCancelledHandler,
            PAYMENT_SUCCESS: this.paymentSuccessHandler,
        };
    }

    private toEpoch(value: unknown): number | null {
        if (value instanceof Date) {
            return value.getTime();
        }

        if (typeof value === 'number' && Number.isFinite(value)) {
            return Math.floor(value);
        }

        if (typeof value === 'string') {
            const parsed = new Date(value).getTime();
            return Number.isNaN(parsed) ? null : parsed;
        }

        return null;
    }

    private normalizeNotificationTimestamps(notification: any): any {
        if (!notification) {
            return notification;
        }

        const normalized = { ...notification };
        normalized.createdAt = this.toEpoch(normalized.createdAt);
        normalized.updatedAt = this.toEpoch(normalized.updatedAt);

        if (normalized.details && typeof normalized.details === 'object') {
            normalized.details = {
                ...normalized.details,
                expiresAt: this.toEpoch(normalized.details.expiresAt),
                runAt: this.toEpoch(normalized.details.runAt),
            };
        }

        return normalized;
    }

    async storeNewNotification(notification: Partial<NotificationDocument>) {
        const newNoti = new this.notificationModel(notification);
        return await newNoti.save();
    }

    async process(payload: NotificationPayload): Promise<void> {
        const handler = this.handlers[payload.type as NotificationType];
        if (!handler) {
            this.logger.warn(`No notification handler registered for type ${payload.type}`);
            return;
        }

        const meta: NotificationHandlerMeta = {
            recipientEmail: payload.recipientEmail,
            createdAt: payload.createdAt,
            idempotencyKey: payload.idempotencyKey,
        };

        await handler.handle(payload.data as never, meta);
    }

    async storeIfNotExists(notification: Partial<NotificationDocument>): Promise<boolean> {
        try {
            await this.storeNewNotification(notification);
            return true;
        } catch (error) {
            // Duplicate key means this notification has already been processed.
            if ((error as { code?: number }).code === 11000) {
                return false;
            }

            throw error;
        }
    }

    async getNotifications(
        pagination: PaginationQueryDto
        ): Promise<PaginationResult<Notification>> {
        const { page, limit } = pagination;

        const skip = (page - 1) * limit;

        const [data, total] = await Promise.all([
            this.notificationModel
            .find()
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),

            this.notificationModel.countDocuments(),
        ]);

        const normalizedData = data.map((item) => this.normalizeNotificationTimestamps(item));
        return new PaginationResult(normalizedData, total, page, limit);
    }
    async getNotificationsByEmail(
        email: string,
        pagination: PaginationQueryDto
        ): Promise<PaginationResult<Notification>> {

        const { page, limit } = pagination;
        const skip = (page - 1) * limit;

        const filter = {
            $or: [
            { isBroadcast: true },
            { receiverEmail: email },
            ],
        };

        const [data, total] = await Promise.all([
            this.notificationModel
            .find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),

            this.notificationModel.countDocuments(filter),
        ]);

        const normalizedData = data.map((item) => this.normalizeNotificationTimestamps(item));
        return new PaginationResult(normalizedData, total, page, limit);
    }

    async countUnreadByEmail(email: string): Promise<number> {
        if (!email) throw new Error('[NotificationService] Email is required');

        return this.notificationModel.countDocuments({
        receiverEmail: email,
        isRead: false,
        });
    }

    async markAsRead(id: string): Promise<Notification> {
        const notif = await this.notificationModel.findByIdAndUpdate(
            id,
            { isRead: true },
            { new: true }
        ).lean();

        if (!notif) throw new NotFoundException('[NotificationService] Notification not found');
        return this.normalizeNotificationTimestamps(notif);
    }

}

