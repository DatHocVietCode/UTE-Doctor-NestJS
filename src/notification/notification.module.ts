import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { AppointmentNotificationListener } from "./listenners/appointment.notify.listenner";
import { CoinExpiryReminderNotificationListener } from "./listenners/coin-expiry-reminder.notify.listenner";
import { NotificationController } from "./notification.controller";
import { NotificationService } from "./notification.service";
import { Notification, NotificationSchema } from "./schemas/notification.schema";

@Module({
    imports: [
        MongooseModule.forFeature([{ name: Notification.name, schema: NotificationSchema }]),
    ],
    providers: [NotificationService, AppointmentNotificationListener, CoinExpiryReminderNotificationListener],
    exports: [NotificationService],
    controllers: [NotificationController]
})
export class NotificationModule {}