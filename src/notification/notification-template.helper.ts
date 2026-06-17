import type { AppointmentEnriched } from 'src/appointment/schemas/appointment-enriched';
import type {
  AppointmentCancelledDto,
  AppointmentDoctorAssignedDto,
  AppointmentRescheduledNotificationDto,
  AssignmentTaskCreatedDto,
  AssignmentTaskExpiredDto,
  AssignmentTaskReminderDto,
  NotificationRecipientRole,
  PaymentSuccessDto,
} from './dto/notification-payload.dto';

export type NotificationStructuredData = Record<string, unknown>;

export type NotificationTemplate = {
  title: string;
  message: string;
  titleKey: string;
  messageKey: string;
  data: NotificationStructuredData;
};

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function epochNumber(value: unknown): number | null {
  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.floor(value);
  }

  if (typeof value === 'string' && /^\d{10,13}$/.test(value)) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function withoutUndefined(
  data: NotificationStructuredData,
): NotificationStructuredData {
  return Object.fromEntries(
    Object.entries(data).filter(([, value]) => value !== undefined),
  );
}

function isAssignmentTimeout(reasonCode: unknown): boolean {
  return reasonCode === 'ASSIGNMENT_TIMEOUT';
}

function appointmentIdOf(payload: AppointmentEnriched): string | null {
  return (
    nullableString(payload.appointmentId) ??
    nullableString(payload._id?.toString?.()) ??
    null
  );
}

export function buildAppointmentSuccessNotification(
  payload: AppointmentEnriched,
  recipientRole: NotificationRecipientRole,
  timeRange?: string,
): NotificationTemplate {
  const doctor = recipientRole === 'DOCTOR';
  return {
    title: doctor
      ? 'Lịch khám mới được gán cho bạn'
      : 'Đặt lịch khám thành công',
    message: doctor
      ? 'Bạn có thông báo lịch khám được gán mới.'
      : 'Bạn có thông báo lịch khám mới.',
    titleKey: doctor
      ? 'notification.doctor.assignedAppointment.title'
      : 'notification.patient.appointmentSuccess.title',
    messageKey: doctor
      ? 'notification.doctor.assignedAppointment.message'
      : 'notification.patient.appointmentSuccess.message',
    data: withoutUndefined({
      appointmentId: appointmentIdOf(payload),
      appointmentDate: epochNumber(payload.scheduledAt ?? payload.date),
      scheduledAt: epochNumber(payload.scheduledAt ?? payload.date),
      bookingDate: epochNumber(payload.bookingDate),
      timeRange: nullableString(timeRange),
      hospitalName: nullableString(payload.hospitalName),
      doctorName: nullableString(payload.doctorName),
      patientName: nullableString(payload.patientName),
      patientEmail: nullableString(payload.patientEmail),
      paymentMethod: nullableString(payload.paymentMethod),
      serviceType: nullableString(payload.serviceType),
      amount: typeof payload.amount === 'number' ? payload.amount : null,
    }),
  };
}

export function buildAppointmentCancelledNotification(
  payload: AppointmentCancelledDto,
  recipientRole: NotificationRecipientRole,
  timeRange?: string,
): NotificationTemplate {
  const doctor = recipientRole === 'DOCTOR';
  const assignmentTimeout = isAssignmentTimeout(payload.reasonCode);

  if (assignmentTimeout) {
    const refundMessage =
      payload.shouldRefund && typeof payload.refundAmount === 'number'
        ? ` Tien coc da duoc hoan vao vi credit: ${payload.refundAmount}.`
        : '';

    return {
      title: doctor
        ? 'Lich kham tu dong huy do qua han phan cong'
        : 'Khong the phan cong bac si dung han',
      message: doctor
        ? 'He thong khong the phan cong bac si trong thoi gian quy dinh nen lich kham da duoc tu dong huy.'
        : `He thong khong the phan cong bac si trong thoi gian quy dinh nen lich kham cua ban da duoc tu dong huy.${refundMessage}`,
      titleKey: doctor
        ? 'notification.doctor.assignmentTimeoutCancelled.title'
        : 'notification.patient.assignmentTimeoutCancelled.title',
      messageKey: doctor
        ? 'notification.doctor.assignmentTimeoutCancelled.message'
        : 'notification.patient.assignmentTimeoutCancelled.message',
      data: withoutUndefined({
        appointmentId: nullableString(payload.appointmentId),
        appointmentDate: epochNumber(payload.scheduledAt ?? payload.date),
        scheduledAt: epochNumber(payload.scheduledAt ?? payload.date),
        timeRange: nullableString(timeRange ?? payload.timeSlotLabel),
        timeSlotId: nullableString(payload.timeSlot),
        hospitalName: nullableString(payload.hospitalName),
        patientEmail: nullableString(payload.patientEmail),
        doctorEmail: nullableString(payload.doctorEmail),
        reason: nullableString(payload.reason),
        refundAmount:
          typeof payload.refundAmount === 'number' ? payload.refundAmount : null,
        shouldRefund:
          typeof payload.shouldRefund === 'boolean'
            ? payload.shouldRefund
            : null,
        actor: nullableString(payload.actor),
        reasonCode: nullableString(payload.reasonCode),
        assignmentTaskId: nullableString(payload.assignmentTaskId),
        deadlineAt: epochNumber(payload.deadlineAt),
      }),
    };
  }

  return {
    title: doctor
      ? 'Bệnh nhân đã hủy lịch khám'
      : 'Lịch khám của bạn đã bị hủy',
    message: doctor
      ? 'Bạn có thông báo hủy lịch khám từ bệnh nhân.'
      : 'Bạn có thông báo hủy lịch khám của mình.',
    titleKey: doctor
      ? 'notification.doctor.appointmentCancelled.title'
      : 'notification.patient.appointmentCancelled.title',
    messageKey: doctor
      ? 'notification.doctor.appointmentCancelled.message'
      : 'notification.patient.appointmentCancelled.message',
    data: withoutUndefined({
      appointmentId: nullableString(payload.appointmentId),
      appointmentDate: epochNumber(payload.scheduledAt ?? payload.date),
      scheduledAt: epochNumber(payload.scheduledAt ?? payload.date),
      timeRange: nullableString(timeRange ?? payload.timeSlotLabel),
      timeSlotId: nullableString(payload.timeSlot),
      hospitalName: nullableString(payload.hospitalName),
      patientEmail: nullableString(payload.patientEmail),
      doctorEmail: nullableString(payload.doctorEmail),
      reason: nullableString(payload.reason),
      refundAmount:
        typeof payload.refundAmount === 'number' ? payload.refundAmount : null,
      shouldRefund:
        typeof payload.shouldRefund === 'boolean' ? payload.shouldRefund : null,
      actor: nullableString(payload.actor),
      reasonCode: nullableString(payload.reasonCode),
      assignmentTaskId: nullableString(payload.assignmentTaskId),
      deadlineAt: epochNumber(payload.deadlineAt),
    }),
  };
}

export function buildAppointmentRescheduledNotification(
  payload: AppointmentRescheduledNotificationDto,
  recipientRole: NotificationRecipientRole,
  timeRange?: string,
): NotificationTemplate {
  const doctor = recipientRole === 'DOCTOR';

  return {
    title: doctor
      ? 'Lịch khám đã được đổi lịch'
      : 'Lịch khám của bạn đã được đổi lịch',
    message: doctor
      ? 'Bạn có thông báo đổi lịch khám với bệnh nhân.'
      : 'Bạn có thông báo đổi lịch khám của mình.',
    titleKey: doctor
      ? 'notification.doctor.appointmentRescheduled.title'
      : 'notification.patient.appointmentRescheduled.title',
    messageKey: doctor
      ? 'notification.doctor.appointmentRescheduled.message'
      : 'notification.patient.appointmentRescheduled.message',
    data: withoutUndefined({
      appointmentId: nullableString(payload.appointmentId),
      appointmentDate: epochNumber(payload.newScheduledAt),
      scheduledAt: epochNumber(payload.newScheduledAt),
      oldScheduledAt: epochNumber(payload.oldScheduledAt),
      newScheduledAt: epochNumber(payload.newScheduledAt),
      timeRange: nullableString(timeRange),
      timeSlotId: nullableString(payload.newTimeSlotId),
      hospitalName: nullableString(payload.hospitalName),
      doctorName: nullableString(payload.doctorName),
      patientEmail: nullableString(payload.patientEmail),
      doctorEmail: nullableString(payload.doctorEmail),
      reason: nullableString(payload.reason),
    }),
  };
}

export function buildAppointmentDoctorAssignedNotification(
  payload: AppointmentDoctorAssignedDto,
): NotificationTemplate {
  return {
    title: 'Bác sĩ đã được phân công',
    message: 'Bạn có thông báo phân công bác sĩ.',
    titleKey: 'notification.patient.doctorAssigned.title',
    messageKey: 'notification.patient.doctorAssigned.message',
    data: withoutUndefined({
      appointmentId: nullableString(payload.appointmentId),
      doctorId: nullableString(payload.doctorId),
      timeSlotId: nullableString(payload.timeSlotId),
      appointmentDate: epochNumber(payload.scheduledAt),
      scheduledAt: epochNumber(payload.scheduledAt),
      patientEmail: nullableString(payload.patientEmail),
    }),
  };
}

export function buildPaymentSuccessNotification(
  payload: PaymentSuccessDto,
): NotificationTemplate {
  return {
    title: 'Thanh toán thành công',
    message: 'Bạn có thông báo thanh toán.',
    titleKey: 'notification.patient.paymentSuccess.title',
    messageKey: 'notification.patient.paymentSuccess.message',
    data: withoutUndefined({
      appointmentId:
        nullableString(payload.appointmentId) ??
        nullableString(payload.orderId),
      orderId: nullableString(payload.orderId),
      status: payload.status,
      appointmentDate: epochNumber(payload.appointmentDate),
      scheduledAt: epochNumber(payload.scheduledAt),
      bookingDate: epochNumber(payload.bookingDate),
      hospitalName: nullableString(payload.hospitalName),
    }),
  };
}

export function buildAssignmentTaskCreatedNotification(
  payload: AssignmentTaskCreatedDto,
): NotificationTemplate {
  return {
    title: 'Yêu cầu đặt khám cần phân công bác sĩ',
    message: 'Bạn có thông báo yêu cầu đặt khám cần xử lý.',
    titleKey: 'notification.receptionist.assignmentTaskCreated.title',
    messageKey: 'notification.receptionist.assignmentTaskCreated.message',
    data: withoutUndefined({
      taskId: nullableString(payload.taskId),
      appointmentId: nullableString(payload.appointmentId),
      specialty: nullableString(payload.specialty),
      reasonForAppointment: nullableString(payload.reasonForAppointment),
      deadlineAt: epochNumber(payload.deadlineAt),
      priority: nullableString(payload.priority),
      online: typeof payload.online === 'boolean' ? payload.online : null,
    }),
  };
}

export function buildAssignmentTaskReminderNotification(
  payload: AssignmentTaskReminderDto,
): NotificationTemplate {
  return {
    title: 'Nhắc nhở: yêu cầu đặt khám sắp quá hạn phân công',
    message: 'Bạn có thông báo nhắc nhở phân công bác sĩ.',
    titleKey: 'notification.receptionist.assignmentTaskReminder.title',
    messageKey: 'notification.receptionist.assignmentTaskReminder.message',
    data: withoutUndefined({
      taskId: nullableString(payload.taskId),
      appointmentId: nullableString(payload.appointmentId),
      deadlineAt: epochNumber(payload.deadlineAt),
      reminderCount:
        typeof payload.reminderCount === 'number'
          ? payload.reminderCount
          : null,
      online: typeof payload.online === 'boolean' ? payload.online : null,
    }),
  };
}

export function buildAssignmentTaskExpiredNotification(
  payload: AssignmentTaskExpiredDto,
): NotificationTemplate {
  if (isAssignmentTimeout(payload.reasonCode)) {
    return {
      title: 'Yeu cau phan cong da qua han',
      message: 'Yeu cau phan cong da qua han; lich kham da duoc tu dong huy.',
      titleKey: 'notification.receptionist.assignmentTimeoutExpired.title',
      messageKey: 'notification.receptionist.assignmentTimeoutExpired.message',
      data: withoutUndefined({
        taskId: nullableString(payload.taskId),
        appointmentId: nullableString(payload.appointmentId),
        deadlineAt: epochNumber(payload.deadlineAt),
        actor: nullableString(payload.actor),
        reasonCode: nullableString(payload.reasonCode),
        online: typeof payload.online === 'boolean' ? payload.online : null,
      }),
    };
  }

  return {
    title: 'Yêu cầu đặt khám đã quá hạn phân công',
    message: 'Bạn có thông báo yêu cầu đặt khám quá hạn.',
    titleKey: 'notification.receptionist.assignmentTaskExpired.title',
    messageKey: 'notification.receptionist.assignmentTaskExpired.message',
    data: withoutUndefined({
      taskId: nullableString(payload.taskId),
      appointmentId: nullableString(payload.appointmentId),
      deadlineAt: epochNumber(payload.deadlineAt),
      online: typeof payload.online === 'boolean' ? payload.online : null,
    }),
  };
}
