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

// Broad-appointment assignment task awaiting a receptionist.
export type AssignmentTaskCreatedDto = {
  taskId: string;
  appointmentId: string;
  specialty?: string;
  reasonForAppointment?: string;
  deadlineAt: number;
  priority?: string;
};

// Patient-facing: a receptionist assigned a doctor/slot to a broad appointment.
export type AppointmentDoctorAssignedDto = {
  appointmentId: string;
  doctorId: string;
  timeSlotId: string;
  scheduledAt: number;
  patientEmail?: string;
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
  ASSIGNMENT_TASK_CREATED: AssignmentTaskCreatedDto;
  APPOINTMENT_DOCTOR_ASSIGNED: AppointmentDoctorAssignedDto;
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
