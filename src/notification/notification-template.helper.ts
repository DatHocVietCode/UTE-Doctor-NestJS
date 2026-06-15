import type { AppointmentEnriched } from 'src/appointment/schemas/appointment-enriched';
import type {
  AppointmentCancelledDto,
  AppointmentRescheduledNotificationDto,
  AssignmentTaskCreatedDto,
  AssignmentTaskExpiredDto,
  NotificationRecipientRole,
  PaymentSuccessDto,
} from './dto/notification-payload.dto';

export type NotificationTemplate = {
  title: string;
  message: string;
};

function withOptionalPlace(message: string, hospitalName?: string): string {
  return hospitalName ? `${message} tại ${hospitalName}` : message;
}

export function buildAppointmentSuccessNotification(
  payload: AppointmentEnriched,
  recipientRole: NotificationRecipientRole,
  timeSlotName?: string,
): NotificationTemplate {
  const slotText = timeSlotName ? ` lúc ${timeSlotName}` : '';
  const baseSchedule = `${payload.date}${slotText}`;

  if (recipientRole === 'DOCTOR') {
    return {
      title: 'Lịch khám mới được gán cho bạn',
      message:
        withOptionalPlace(
          `Bạn có lịch khám mới với bệnh nhân ${payload.patientEmail} vào ngày ${baseSchedule}`,
          payload.hospitalName,
        ) + '.',
    };
  }

  return {
    title: 'Đặt lịch khám thành công',
    message:
      withOptionalPlace(
        `Lịch khám của bạn đã được xác nhận vào ngày ${baseSchedule}`,
        payload.hospitalName,
      ) + '.',
  };
}

export function buildAppointmentCancelledNotification(
  payload: AppointmentCancelledDto,
  recipientRole: NotificationRecipientRole,
  timeSlotName?: string,
): NotificationTemplate {
  const slotText = timeSlotName || payload.timeSlotLabel || payload.timeSlot;
  const schedule = `${payload.date}${slotText ? ` lúc ${slotText}` : ''}`;
  const place = payload.hospitalName ? ` tại ${payload.hospitalName}` : '';
  const reason = payload.reason ? ` Lý do: ${payload.reason}.` : '';

  if (recipientRole === 'DOCTOR') {
    if (payload.appointmentId?.startsWith('doctor-shift-')) {
      return {
        title: 'Ca trực của bạn đã bị hủy',
        message: `Ca trực ${payload.timeSlot} ngày ${payload.date}${reason ? `.${reason}` : '.'}`,
      };
    }

    return {
      title: 'Bệnh nhân đã hủy lịch khám',
      message: `Bệnh nhân ${payload.patientEmail} đã hủy lịch khám ngày ${schedule}${place}.${reason}`,
    };
  }

  return {
    title: 'Lịch khám của bạn đã bị hủy',
    message: `Lịch khám của bạn ngày ${schedule}${place} đã bị hủy.${reason}`,
  };
}

export function buildAppointmentRescheduledNotification(
  payload: AppointmentRescheduledNotificationDto,
  recipientRole: NotificationRecipientRole,
  newDateText: string,
  timeSlotName?: string,
): NotificationTemplate {
  const slotText = timeSlotName ? ` - ${timeSlotName}` : '';
  const place = payload.hospitalName ? ` tại ${payload.hospitalName}` : '';

  if (recipientRole === 'DOCTOR') {
    return {
      title: 'Lịch khám đã được đổi lịch',
      message: `Lịch khám với bệnh nhân ${payload.patientEmail} đã được đổi sang ${newDateText}${slotText}${place}.`,
    };
  }

  return {
    title: 'Lịch khám của bạn đã được đổi lịch',
    message: `Lịch khám của bạn đã được đổi sang ${newDateText}${slotText}${place}.`,
  };
}

export function buildAppointmentDoctorAssignedNotification(): NotificationTemplate {
  return {
    title: 'Bác sĩ đã được phân công',
    message: 'Lễ tân đã phân công bác sĩ và lịch khám cho yêu cầu của bạn.',
  };
}

export function buildPaymentSuccessNotification(
  payload: PaymentSuccessDto,
): NotificationTemplate {
  return {
    title: 'Thanh toán thành công',
    message: `Thanh toán đơn ${payload.orderId} của bạn đã hoàn tất thành công.`,
  };
}

export function buildAssignmentTaskCreatedNotification(
  payload: AssignmentTaskCreatedDto,
): NotificationTemplate {
  return {
    title: 'Yêu cầu đặt khám cần phân công bác sĩ',
    message: payload.specialty
      ? `Có yêu cầu đặt khám mới (${payload.specialty}) đang chờ phân công bác sĩ.`
      : 'Có yêu cầu đặt khám mới đang chờ phân công bác sĩ.',
  };
}

export function buildAssignmentTaskReminderNotification(): NotificationTemplate {
  return {
    title: 'Nhắc nhở: yêu cầu đặt khám sắp quá hạn phân công',
    message:
      'Có yêu cầu đặt khám đang chờ phân công bác sĩ và sắp quá hạn. Vui lòng xử lý sớm.',
  };
}

export function buildAssignmentTaskExpiredNotification(
  _payload: AssignmentTaskExpiredDto,
): NotificationTemplate {
  return {
    title: 'Yêu cầu đặt khám đã quá hạn phân công',
    message:
      'Có yêu cầu đặt khám đã quá hạn phân công bác sĩ. Vui lòng xử lý thủ công (liên hệ bệnh nhân / phân công lại).',
  };
}
