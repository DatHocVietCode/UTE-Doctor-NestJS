import type { AppointmentEnriched } from 'src/appointment/schemas/appointment-enriched';
import type { CoinExpiryReminderEventPayload } from 'src/wallet/coin/coin-expiry-reminder/dto/coin-expiry-reminder.dto';

export type AppointmentCancelledDto = {
  appointmentId: string;
  patientEmail: string;
  doctorEmail?: string;
  date: string;
  timeSlot: string;
  timeSlotLabel?: string;
  hospitalName?: string;
  reason?: string;
  refundAmount?: number;
  shouldRefund?: boolean;
};

export type PaymentSuccessDto = {
  orderId: string;
  status: 'COMPLETED';
};

export type AppointmentRescheduledNotificationDto = {
  appointmentId: string;
  patientEmail: string;
  doctorEmail?: string;
  doctorName?: string;
  hospitalName?: string;
  oldScheduledAt: number;
  newScheduledAt: number;
  newTimeSlotId: string;
  reason?: string;
};

export type NotificationMap = {
  COIN_EXPIRY_REMINDER: CoinExpiryReminderEventPayload;
  APPOINTMENT_SUCCESS: AppointmentEnriched;
  APPOINTMENT_CANCELLED: AppointmentCancelledDto;
  APPOINTMENT_RESCHEDULED: AppointmentRescheduledNotificationDto;
  PAYMENT_SUCCESS: PaymentSuccessDto;
};

export type NotificationType = keyof NotificationMap;

export type NotificationPayload = {
  [K in keyof NotificationMap]: {
    type: K;
    data: NotificationMap[K];
    createdAt: number;
    recipientEmail: string;
    idempotencyKey: string;
    retryCount?: number;
  }
}[keyof NotificationMap];
