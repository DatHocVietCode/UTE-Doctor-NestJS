import type { AppointmentEnriched } from 'src/appointment/schemas/appointment-enriched';
import type { CoinExpiryReminderEventPayload } from 'src/wallet/coin/coin-expiry-reminder/dto/coin-expiry-reminder.dto';

export type AppointmentCancelledDto = {
  appointmentId: string;
  patientEmail: string;
  doctorEmail?: string;
  date: string | number | Date;
  scheduledAt?: number;
  timeSlot: string;
  timeSlotLabel?: string;
  hospitalName?: string;
  reason?: string;
  refundAmount?: number;
  shouldRefund?: boolean;
};

export const NOTIFICATION_RECIPIENT_ROLES = [
  'PATIENT',
  'DOCTOR',
  'RECEPTIONIST',
  'ADMIN',
] as const;

export type NotificationRecipientRole =
  (typeof NOTIFICATION_RECIPIENT_ROLES)[number];

export type PaymentSuccessDto = {
  orderId: string;
  status: 'COMPLETED';
  appointmentId?: string;
  appointmentDate?: number;
  scheduledAt?: number;
  bookingDate?: number;
  hospitalName?: string | null;
};

// Broad-appointment assignment task awaiting a receptionist.
export type AssignmentTaskCreatedDto = {
  taskId: string;
  appointmentId: string;
  specialty?: string;
  reasonForAppointment?: string;
  deadlineAt: number;
  priority?: string;
  // True when this recipient was resolved as online via Redis role-aware presence at emit time.
  online?: boolean;
};

// SLA reminder for a PENDING assignment task nearing its deadline.
export type AssignmentTaskReminderDto = {
  taskId: string;
  appointmentId?: string;
  deadlineAt: number;
  reminderCount?: number;
  online?: boolean;
};

// SLA expiry: a PENDING assignment task passed its deadline + grace and needs manual attention.
export type AssignmentTaskExpiredDto = {
  taskId: string;
  appointmentId?: string;
  deadlineAt: number;
  online?: boolean;
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
  ASSIGNMENT_TASK_REMINDER: AssignmentTaskReminderDto;
  ASSIGNMENT_TASK_EXPIRED: AssignmentTaskExpiredDto;
  APPOINTMENT_DOCTOR_ASSIGNED: AppointmentDoctorAssignedDto;
};

export type NotificationType = keyof NotificationMap;

export type NotificationPayload = {
  [K in keyof NotificationMap]: {
    type: K;
    data: NotificationMap[K];
    createdAt: number;
    recipientEmail: string;
    recipientRole: NotificationRecipientRole;
    idempotencyKey: string;
    retryCount?: number;
  };
}[keyof NotificationMap];
