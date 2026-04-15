import { Injectable } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { COIN_EXPIRY_REMINDER_NOTIFICATION_EVENT } from "src/wallet/coin/coin-expiry-reminder/coin-expiry-reminder.constants";
import type { CoinExpiryReminderEventPayload } from "src/wallet/coin/coin-expiry-reminder/dto/coin-expiry-reminder.dto";
import { NotificationService } from "../notification.service";

@Injectable()
export class CoinExpiryReminderNotificationListener {
    constructor(private readonly notificationService: NotificationService) {}

    @OnEvent(COIN_EXPIRY_REMINDER_NOTIFICATION_EVENT)
    handleCoinExpiryReminder(payload: CoinExpiryReminderEventPayload) {
        // Persist reminder notification to support client polling fallback when realtime push is missed.
        this.notificationService.createCoinExpiryReminderNotification(payload);
    }
}
