import { Module } from "@nestjs/common";
import { AppointmentNotificationListener } from "./listenners/appointment.notify.listenner";
import { NotificationService } from "./notification.service";
import { MongooseModule } from "@nestjs/mongoose";
import { Notification, NotificationSchema } from "./schemas/notification.schema";

@Module({
    imports: [
        MongooseModule.forFeature([{ name: Notification.name, schema: NotificationSchema }]),
    ],
    providers: [NotificationService, AppointmentNotificationListener],
    exports: [NotificationService]
})
export class NotificationModule {}