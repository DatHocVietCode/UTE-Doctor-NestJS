import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { RedisService } from "src/common/redis/redis.service";
import { AppointmentCancelledNotificationHandler } from "./handlers/appointment-cancelled-notification.handler";
import { AppointmentSuccessNotificationHandler } from "./handlers/appointment-success-notification.handler";
import { CoinExpiryNotificationHandler } from "./handlers/coin-expiry-notification.handler";
import { PaymentSuccessNotificationHandler } from "./handlers/payment-success-notification.handler";
import { AppointmentNotificationListener } from "./listenners/appointment.notify.listenner";
import { CoinExpiryReminderNotificationListener } from "./listenners/coin-expiry-reminder.notify.listenner";
import { PaymentNotificationListener } from "./listenners/payment.notify.listenner";
import { NotificationJobPublisher } from "./notification-job.publisher";
import { NotificationQueueConsumer } from "./notification-queue.consumer";
import { NotificationWriteService } from "./notification-write.service";
import { NotificationController } from "./notification.controller";
import { NotificationService } from "./notification.service";
import { Notification, NotificationSchema } from "./schemas/notification.schema";

@Module({
    imports: [
        MongooseModule.forFeature([{ name: Notification.name, schema: NotificationSchema }]),
    ],
    providers: [
        NotificationService,
        NotificationWriteService,
        NotificationJobPublisher,
        NotificationQueueConsumer,
        AppointmentNotificationListener,
        CoinExpiryReminderNotificationListener,
        PaymentNotificationListener,
        CoinExpiryNotificationHandler,
        AppointmentSuccessNotificationHandler,
        AppointmentCancelledNotificationHandler,
        PaymentSuccessNotificationHandler,
        RedisService,
    ],
    exports: [NotificationService],
    controllers: [NotificationController]
})
export class NotificationModule {}