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
  return hospitalName ? `${message} tai ${hospitalName}` : message;
}

export function buildAppointmentSuccessNotification(
  payload: AppointmentEnriched,
  recipientRole: NotificationRecipientRole,
  timeSlotName?: string,
): NotificationTemplate {
  const slotText = timeSlotName ? ` luc ${timeSlotName}` : '';
  const baseSchedule = `${payload.date}${slotText}`;

  if (recipientRole === 'DOCTOR') {
    return {
      title: 'Lich kham moi duoc gan cho ban',
      message:
        withOptionalPlace(
          `Ban co lich kham moi voi benh nhan ${payload.patientEmail} vao ngay ${baseSchedule}`,
          payload.hospitalName,
        ) + '.',
    };
  }

  return {
    title: 'Dat lich kham thanh cong',
    message:
      withOptionalPlace(
        `Lich kham cua ban da duoc xac nhan vao ngay ${baseSchedule}`,
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
  const schedule = `${payload.date}${slotText ? ` luc ${slotText}` : ''}`;
  const place = payload.hospitalName ? ` tai ${payload.hospitalName}` : '';
  const reason = payload.reason ? ` Ly do: ${payload.reason}.` : '';

  if (recipientRole === 'DOCTOR') {
    if (payload.appointmentId?.startsWith('doctor-shift-')) {
      return {
        title: 'Ca truc cua ban da bi huy',
        message: `Ca truc ${payload.timeSlot} ngay ${payload.date}${reason ? `.${reason}` : '.'}`,
      };
    }

    return {
      title: 'Benh nhan da huy lich kham',
      message: `Benh nhan ${payload.patientEmail} da huy lich kham ngay ${schedule}${place}.${reason}`,
    };
  }

  return {
    title: 'Lich kham cua ban da bi huy',
    message: `Lich kham cua ban ngay ${schedule}${place} da bi huy.${reason}`,
  };
}

export function buildAppointmentRescheduledNotification(
  payload: AppointmentRescheduledNotificationDto,
  recipientRole: NotificationRecipientRole,
  newDateText: string,
  timeSlotName?: string,
): NotificationTemplate {
  const slotText = timeSlotName ? ` - ${timeSlotName}` : '';
  const place = payload.hospitalName ? ` tai ${payload.hospitalName}` : '';

  if (recipientRole === 'DOCTOR') {
    return {
      title: 'Lich kham da duoc doi lich',
      message: `Lich kham voi benh nhan ${payload.patientEmail} da duoc doi sang ${newDateText}${slotText}${place}.`,
    };
  }

  return {
    title: 'Lich kham cua ban da duoc doi lich',
    message: `Lich kham cua ban da duoc doi sang ${newDateText}${slotText}${place}.`,
  };
}

export function buildAppointmentDoctorAssignedNotification(): NotificationTemplate {
  return {
    title: 'Bac si da duoc phan cong',
    message: 'Le tan da phan cong bac si va lich kham cho yeu cau cua ban.',
  };
}

export function buildPaymentSuccessNotification(
  payload: PaymentSuccessDto,
): NotificationTemplate {
  return {
    title: 'Thanh toan thanh cong',
    message: `Thanh toan don ${payload.orderId} cua ban da hoan tat thanh cong.`,
  };
}

export function buildAssignmentTaskCreatedNotification(
  payload: AssignmentTaskCreatedDto,
): NotificationTemplate {
  return {
    title: 'Yeu cau dat kham can phan cong bac si',
    message: payload.specialty
      ? `Co yeu cau dat kham moi (${payload.specialty}) dang cho phan cong bac si.`
      : 'Co yeu cau dat kham moi dang cho phan cong bac si.',
  };
}

export function buildAssignmentTaskReminderNotification(): NotificationTemplate {
  return {
    title: 'Nhac nho: yeu cau dat kham sap qua han phan cong',
    message:
      'Co yeu cau dat kham dang cho phan cong bac si va sap qua han. Vui long xu ly som.',
  };
}

export function buildAssignmentTaskExpiredNotification(
  _payload: AssignmentTaskExpiredDto,
): NotificationTemplate {
  return {
    title: 'Yeu cau dat kham da qua han phan cong',
    message:
      'Co yeu cau dat kham da qua han phan cong bac si. Vui long xu ly thu cong (lien he benh nhan / phan cong lai).',
  };
}
