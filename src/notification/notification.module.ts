import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Account, AccountSchema } from 'src/account/schemas/account.schema';
import { RedisService } from 'src/common/redis/redis.service';
import { PresenceService } from 'src/socket/presence.service';
import { AppointmentCancelledNotificationHandler } from './handlers/appointment-cancelled-notification.handler';
import { AppointmentNoShowNotificationHandler } from './handlers/appointment-no-show-notification.handler';
import { AppointmentDoctorAssignedNotificationHandler } from './handlers/appointment-doctor-assigned-notification.handler';
import { AppointmentRescheduledNotificationHandler } from './handlers/appointment-rescheduled-notification.handler';
import { AppointmentSuccessNotificationHandler } from './handlers/appointment-success-notification.handler';
import { AssignmentTaskCreatedNotificationHandler } from './handlers/assignment-task-created-notification.handler';
import { AssignmentTaskExpiredNotificationHandler } from './handlers/assignment-task-expired-notification.handler';
import { AssignmentTaskReminderNotificationHandler } from './handlers/assignment-task-reminder-notification.handler';
import { CoinExpiryNotificationHandler } from './handlers/coin-expiry-notification.handler';
import { PaymentSuccessNotificationHandler } from './handlers/payment-success-notification.handler';
import { AppointmentNotificationListener } from './listenners/appointment.notify.listenner';
import { AssignmentNotificationListener } from './listenners/assignment.notify.listenner';
import { CoinExpiryReminderNotificationListener } from './listenners/coin-expiry-reminder.notify.listenner';
import { PaymentNotificationListener } from './listenners/payment.notify.listenner';
import { NotificationJobPublisher } from './notification-job.publisher';
import { NotificationQueueConsumer } from './notification-queue.consumer';
import { NotificationWriteService } from './notification-write.service';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import {
  Notification,
  NotificationSchema,
} from './schemas/notification.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Notification.name, schema: NotificationSchema },
      { name: Account.name, schema: AccountSchema },
    ]),
  ],
  providers: [
    NotificationService,
    NotificationWriteService,
    NotificationJobPublisher,
    NotificationQueueConsumer,
    AppointmentNotificationListener,
    AssignmentNotificationListener,
    CoinExpiryReminderNotificationListener,
    PaymentNotificationListener,
    CoinExpiryNotificationHandler,
    AppointmentSuccessNotificationHandler,
    AppointmentCancelledNotificationHandler,
    AppointmentNoShowNotificationHandler,
    AppointmentRescheduledNotificationHandler,
    PaymentSuccessNotificationHandler,
    AssignmentTaskCreatedNotificationHandler,
    AssignmentTaskReminderNotificationHandler,
    AssignmentTaskExpiredNotificationHandler,
    AppointmentDoctorAssignedNotificationHandler,
    RedisService,
    // Role-aware presence (Redis) for targeting online receptionists; depends only on RedisService.
    PresenceService,
  ],
  exports: [NotificationService],
  controllers: [NotificationController],
})
export class NotificationModule {}
