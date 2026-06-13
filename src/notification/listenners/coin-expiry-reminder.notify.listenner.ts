import { Injectable } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { COIN_EXPIRY_REMINDER_NOTIFICATION_EVENT } from "src/wallet/coin/coin-expiry-reminder/coin-expiry-reminder.constants";
import type { CoinExpiryReminderEventPayload } from "src/wallet/coin/coin-expiry-reminder/dto/coin-expiry-reminder.dto";
import { NotificationJobPublisher } from "../notification-job.publisher";

@Injectable()
export class CoinExpiryReminderNotificationListener {
    constructor(private readonly notificationPublisher: NotificationJobPublisher) {}

    @OnEvent(COIN_EXPIRY_REMINDER_NOTIFICATION_EVENT)
    async handleCoinExpiryReminder(payload: CoinExpiryReminderEventPayload) {
        if (!payload?.patientEmail) {
            return;
        }

        const recipientEmail = payload.patientEmail.trim().toLowerCase();

        await this.notificationPublisher.publish({
            type: 'COIN_EXPIRY_REMINDER',
            data: payload,
            createdAt: Date.now(),
            recipientEmail,
            idempotencyKey: `COIN_EXPIRY_REMINDER:${payload.transactionId}`,
        });
    }
}
