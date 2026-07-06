import { MailerService } from "@nestjs-modules/mailer";
import { Injectable } from "@nestjs/common";
import { EventEmitter2, OnEvent } from "@nestjs/event-emitter";
import { AssignmentStatus } from "src/appointment/enums/assignment-status.enum";
import { ServiceType } from "src/appointment/enums/service-type.enum";
import { RoleEnum } from "src/common/enum/role.enum";
import type { AppointmentEnriched } from "src/appointment/schemas/appointment-enriched";
import { emitTyped } from "src/utils/helpers/event.helper";
import {
  DEFAULT_LOCATION_FALLBACK,
  formatVietnamTimeRange,
} from "src/utils/helpers/human-time.helper";
import type { CoinExpiryReminderEventPayload } from 'src/wallet/coin/coin-expiry-reminder/dto/coin-expiry-reminder.dto';

const SERVICE_TYPE_LABELS: Record<ServiceType, string> = {
  [ServiceType.KHAM_BHYT]: 'Khám bảo hiểm y tế',
  [ServiceType.KHAM_DICH_VU]: 'Khám dịch vụ',
  [ServiceType.KHAM_ONLINE]: 'Khám trực tuyến',
};

type StaffAccountCreatedRole = RoleEnum.DOCTOR | RoleEnum.RECEPTIONIST;

const ACCOUNT_CREATED_MAIL_COPY: Record<StaffAccountCreatedRole, { subject: string; intro: string }> = {
  [RoleEnum.DOCTOR]: {
    subject: 'UTE Doctor - Thông tin tài khoản bác sĩ',
    intro: 'Tài khoản bác sĩ của bạn đã được tạo.',
  },
  [RoleEnum.RECEPTIONIST]: {
    subject: 'UTE Doctor - Thông tin tài khoản lễ tân',
    intro: 'Tài khoản lễ tân của bạn đã được tạo.',
  },
};

@Injectable()
export class MailService {
  constructor(private readonly mailerService: MailerService
                , private readonly eventEmitter: EventEmitter2
  ) {}

  /** === COMMON SEND FUNCTION === */
  private async sendMail(to: string, subject: string, html: string) {
    if (!to) {
      console.error("[MailService] Missing recipient email!");
      return;
    }

    try {
      await this.mailerService.sendMail({
        to,
        subject,
        html,
        text: "This email is automatically sent by UTE-Doctor, please do not reply.",
      });

      console.log(`[MailService] Mail sent to ${to} | Subject: ${subject}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[MailService] Failed to send mail to ${to} | Subject: ${subject} | Error: ${errorMsg}`);
      // Do not rethrow: mail is best-effort and should not crash API flows.
    }
  }

  async sendAccountCreatedMail(payload: {
    toEmail: string;
    password: string;
    role?: StaffAccountCreatedRole;
  }) {
    const { toEmail, password, role = RoleEnum.DOCTOR } = payload;
    const copy = ACCOUNT_CREATED_MAIL_COPY[role];
    const html = `
      <h2>Xin chào,</h2>
      <p>${copy.intro}</p>
      <p><b>Email:</b> ${toEmail}</p>
      <p><b>Mật khẩu tạm thời:</b> <code>${password}</code></p>
      <p>Vui lòng đăng nhập và đổi mật khẩu sau khi đăng nhập lần đầu.</p>
    `;

    await this.sendMail(toEmail, copy.subject, html);
  }

  /** === OTP === */
  @OnEvent("mail.otp.send")
  async sendOtpMail(payload: { toEmail: string; otp: string }) {
    const { toEmail, otp } = payload;
    const html = `
      <h2>Xin chào!</h2>
      <p>Mã OTP của bạn là:</p>
      <h1 style="color:#007bff;">${otp}</h1>
      <p>OTP có hiệu lực trong 5 phút. Vui lòng không chia sẻ mã này cho người khác.</p>
    `;
    await this.sendMail(toEmail, "Xác thực OTP - UTE Doctor", html);
  }

  /** === BOOKING SUCCESS: PATIENT === */
  async sendPatientBookingSuccessMail(payload: AppointmentEnriched) {
    // A broad (unassigned) appointment reuses this mail once a receptionist assigns
    // the doctor/slot — surface that explicitly so the patient understands who/when/where.
    const isDoctorAssignment = payload.assignmentStatus === AssignmentStatus.ASSIGNED;
    // Time fields are epoch ms on the contract; format ONLY for the readable body.
    const timeText = formatVietnamTimeRange(
      payload.startTime,
      payload.endTime,
      payload.scheduledAt ?? payload.date,
    );
    const slotName = await this.safeTimeSlotName(payload.timeSlot);
    const greetingName = payload.patientName || payload.patientEmail;

    const subject = isDoctorAssignment
      ? 'Bác sĩ đã được phân công cho lịch khám của bạn - UTE Doctor'
      : 'Xác nhận lịch khám - UTE Doctor';
    const intro = isDoctorAssignment
      ? 'Lễ tân đã phân công bác sĩ cho lịch khám của bạn. Thông tin chi tiết:'
      : 'Lịch khám của bạn đã được xác nhận thành công!';

    const html = `
      <h2>Xin chào ${greetingName},</h2>
      <p>${intro}</p>
      <p><b>Bác sĩ:</b> ${payload.doctorName || 'Sẽ được cập nhật'}</p>
      <p><b>Thời gian khám:</b> ${timeText}${slotName ? ` (${slotName})` : ''}</p>
      <p><b>Địa điểm:</b> ${payload.hospitalName || DEFAULT_LOCATION_FALLBACK}</p>
      ${this.serviceTypeLine(payload.serviceType)}
      <p>Vui lòng đến trước giờ hẹn 10–15 phút và mang theo giấy tờ tùy thân để làm thủ tục.</p>
      <p>Cảm ơn bạn đã tin tưởng UTE Doctor!</p>
    `;
    await this.sendMail(payload.patientEmail, subject, html);
  }

  /** === BOOKING SUCCESS: DOCTOR === */
  async sendDoctorBookingSuccessMail(payload: AppointmentEnriched) {
    const timeText = formatVietnamTimeRange(
      payload.startTime,
      payload.endTime,
      payload.scheduledAt ?? payload.date,
    );
    const slotName = await this.safeTimeSlotName(payload.timeSlot);
    const html = `
      <h2>Xin chào bác sĩ ${payload.doctorName || ''},</h2>
      <p>Bạn có lịch hẹn mới!</p>
      <p><b>Bệnh nhân:</b> ${payload.patientName || payload.patientEmail}</p>
      <p><b>Thời gian khám:</b> ${timeText}${slotName ? ` (${slotName})` : ''}</p>
      <p><b>Địa điểm:</b> ${payload.hospitalName || DEFAULT_LOCATION_FALLBACK}</p>
    `;
    await this.sendMail(payload.doctorEmail!, "Lịch hẹn mới - UTE Doctor", html); // When booking is successful, doctor email is guaranteed
  }

  /** Build the optional "service type" line, omitted when the value is unknown. */
  private serviceTypeLine(serviceType?: ServiceType): string {
    if (!serviceType) {
      return '';
    }
    const label = SERVICE_TYPE_LABELS[serviceType] ?? serviceType;
    return `<p><b>Loại dịch vụ:</b> ${label}</p>`;
  }

  /**
   * Resolve a time-slot display name without ever crashing the mail flow.
   * The enriched payload may carry `timeSlot` as a populated object ({ _id }),
   * a raw ObjectId, or be absent entirely (broad bookings) — all handled here.
   */
  private async safeTimeSlotName(timeSlot: unknown): Promise<string | null> {
    const id = this.extractTimeSlotId(timeSlot);
    if (!id) {
      return null;
    }
    try {
      const name = await emitTyped<string, string>(
        this.eventEmitter,
        'timeslot.get.name.by.id',
        id,
      );
      return typeof name === 'string' && name.trim() ? name.trim() : null;
    } catch {
      return null;
    }
  }

  private extractTimeSlotId(timeSlot: unknown): string | null {
    if (!timeSlot) {
      return null;
    }
    if (typeof timeSlot === 'string') {
      return timeSlot.trim() || null;
    }
    const asAny = timeSlot as { _id?: { toString(): string }; toString?: () => string };
    if (asAny._id) {
      return asAny._id.toString();
    }
    if (typeof asAny.toString === 'function') {
      const str = asAny.toString();
      return /^[a-f0-9]{24}$/i.test(str) ? str : null;
    }
    return null;
  }

  /** === SHIFT CANCELLATION: PATIENT === */
  async sendPatientShiftCancellationMail(payload: {
    patientEmail: string;
    doctorName?: string;
    date: string;
    timeSlot: string;
    hospitalName?: string;
    reason?: string;
  }) {
    const timeSlotName = await emitTyped<string, string>(
      this.eventEmitter,
      'timeslot.get.name.by.id',
      payload.timeSlot
    );

    const html = `
      <h2>Xin chào ${payload.patientEmail},</h2>
      <p>Chúng tôi rất tiếc thông báo ca khám của bạn đã bị hủy.</p>
      ${payload.doctorName ? `<p><b>Bác sĩ:</b> ${payload.doctorName}</p>` : ''}
      <p><b>Thời gian:</b> ${payload.date} - ${timeSlotName}</p>
      ${payload.hospitalName ? `<p>Địa điểm: ${payload.hospitalName}</p>` : ''}
      ${payload.reason ? `<p><b>Lý do:</b> ${payload.reason}</p>` : ''}
      <p>Vui lòng đặt lại lịch hoặc liên hệ bộ phận hỗ trợ nếu cần.</p>
    `;
    await this.sendMail(payload.patientEmail, "Thông báo hủy ca khám - UTE Doctor", html);
  }

  /** === SHIFT CANCELLATION: DOCTOR === */
  async sendDoctorShiftCancellationMail(payload: {
    doctorEmail: string;
    doctorName?: string;
    date: string;
    shift: string;
    reason?: string;
    affectedAppointmentsCount: number;
  }) {
    const shiftName = payload.shift === 'morning' ? 'sáng' : payload.shift === 'afternoon' ? 'trưa' : 'ngoài giờ';
    const html = `
      <h2>Xin chào bác sĩ ${payload.doctorName || ''},</h2>
      <p>Ca trực của bạn đã được hủy thành công.</p>
      <p><b>Ca:</b> Ca ${shiftName}</p>
      <p><b>Ngày:</b> ${payload.date}</p>
      ${payload.reason ? `<p><b>Lý do:</b> ${payload.reason}</p>` : ''}
      <p><b>Số lịch hẹn bị ảnh hưởng:</b> ${payload.affectedAppointmentsCount}</p>
      <p>Các bệnh nhân đã được thông báo và hoàn tiền tự động.</p>
    `;
    await this.sendMail(payload.doctorEmail, "Xác nhận hủy ca trực - UTE Doctor", html);
  }

  /** === APPOINTMENT CANCELLATION: PATIENT === */
  async sendPatientAppointmentCancellationMail(payload: {
    patientEmail: string;
    doctorName?: string;
    date: string;
    timeSlot: string;
    hospitalName?: string;
    reason?: string;
    refundAmount?: number;
    shouldRefund?: boolean;
    actor?: string;
    reasonCode?: string;
    assignmentTaskId?: string;
    deadlineAt?: number;
  }) {
    if (payload.reasonCode === 'ASSIGNMENT_TIMEOUT') {
      const refundLine =
        payload.shouldRefund && payload.refundAmount !== undefined
          ? `<p>So credit hoan: <b>${payload.refundAmount}</b></p>`
          : '<p>Don huy khong phat sinh hoan credit.</p>';
      const html = `
        <h2>Xin chao ${payload.patientEmail},</h2>
        <p>He thong khong the phan cong bac si trong thoi gian quy dinh nen lich kham cua ban da duoc tu dong huy.</p>
        <p><b>Thoi gian:</b> ${payload.date}</p>
        ${payload.hospitalName ? `<p><b>Dia diem:</b> ${payload.hospitalName}</p>` : ''}
        ${payload.reason ? `<p><b>Ly do:</b> ${payload.reason}</p>` : ''}
        ${refundLine}
        <p>Neu can ho tro, vui long lien he bo phan ho tro cua UTE Doctor.</p>
      `;

      await this.sendMail(
        payload.patientEmail,
        'Thong bao tu dong huy lich kham - UTE Doctor',
        html,
      );
      return;
    }

    const timeSlotName = await emitTyped<string, string>(
      this.eventEmitter,
      'timeslot.get.name.by.id',
      payload.timeSlot
    );

    const refundLine = payload.shouldRefund && payload.refundAmount !== undefined
      ? `<p>Số credit hoàn: <b>${payload.refundAmount}</b></p>`
      : '<p>Đơn hủy không phát sinh hoàn credit.</p>';

    const html = `
      <h2>Xin chào ${payload.patientEmail},</h2>
      <p>Lịch khám của bạn đã bị hủy.</p>
      ${payload.doctorName ? `<p><b>Bác sĩ:</b> ${payload.doctorName}</p>` : ''}
      <p><b>Thời gian:</b> ${payload.date} - ${timeSlotName}</p>
      ${payload.hospitalName ? `<p>Địa điểm: ${payload.hospitalName}</p>` : ''}
      ${payload.reason ? `<p><b>Lý do:</b> ${payload.reason}</p>` : ''}
      ${refundLine}
      <p>Nếu cần hỗ trợ, vui lòng liên hệ bộ phận hỗ trợ của UTE Doctor.</p>
    `;

    await this.sendMail(payload.patientEmail, "Thông báo hủy lịch khám - UTE Doctor", html);
  }

  /** === NO-SHOW: PATIENT === */
  async sendPatientNoShowMail(payload: {
    patientEmail: string;
    doctorName?: string;
    date: string | number | Date;
    timeSlot?: string;
    timeSlotLabel?: string;
    hospitalName?: string;
    reason?: string;
    depositStatus?: string;
  }) {
    const timeSlotName = payload.timeSlot
      ? await emitTyped<string, string>(this.eventEmitter, 'timeslot.get.name.by.id', payload.timeSlot)
      : (payload.timeSlotLabel ?? '');
    const forfeitLine =
      payload.depositStatus === 'FORFEITED'
        ? '<p>Tiền cọc không được hoàn do bạn không đến khám theo lịch hẹn.</p>'
        : '';
    const html = `
      <h2>Xin chào ${payload.patientEmail},</h2>
      <p>Lịch khám của bạn đã được đánh dấu <b>"Không đến khám"</b> vì đã qua giờ hẹn mà không có mặt.</p>
      ${payload.doctorName ? `<p><b>Bác sĩ:</b> ${payload.doctorName}</p>` : ''}
      <p><b>Thời gian:</b> ${payload.date}${timeSlotName ? ` - ${timeSlotName}` : ''}</p>
      ${payload.hospitalName ? `<p><b>Địa điểm:</b> ${payload.hospitalName}</p>` : ''}
      ${forfeitLine}
      <p>Nếu cần hỗ trợ hoặc đặt lại lịch, vui lòng liên hệ bộ phận hỗ trợ của UTE Doctor.</p>
    `;
    await this.sendMail(payload.patientEmail, 'Thông báo không đến khám - UTE Doctor', html);
  }

  /** === RESCHEDULE: PATIENT === */
  async sendPatientRescheduleMail(payload: {
    patientEmail: string;
    doctorName?: string;
    hospitalName?: string;
    oldScheduledAt: number;
    newScheduledAt: number;
    newTimeSlotId: string;
    reason?: string;
  }) {
    const timeSlotName = await emitTyped<string, string>(
      this.eventEmitter,
      'timeslot.get.name.by.id',
      payload.newTimeSlotId,
    );
    const oldDateStr = new Date(payload.oldScheduledAt).toLocaleString('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      dateStyle: 'short',
      timeStyle: 'short',
    });
    const newDateStr = new Date(payload.newScheduledAt).toLocaleString('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      dateStyle: 'short',
      timeStyle: 'short',
    });

    const html = `
      <h2>Xin chào ${payload.patientEmail},</h2>
      <p>Lịch hẹn của bạn đã được dời lịch thành công.</p>
      ${payload.doctorName ? `<p><b>Bác sĩ:</b> ${payload.doctorName}</p>` : ''}
      <p><b>Lịch cũ:</b> ${oldDateStr}</p>
      <p><b>Lịch mới:</b> ${newDateStr}${timeSlotName ? ` - ${timeSlotName}` : ''}</p>
      ${payload.hospitalName ? `<p><b>Địa điểm:</b> ${payload.hospitalName}</p>` : ''}
      ${payload.reason ? `<p><b>Lý do dời lịch:</b> ${payload.reason}</p>` : ''}
      <p>Vui lòng đến đúng giờ theo lịch mới. Cảm ơn bạn đã sử dụng UTE Doctor!</p>
    `;

    await this.sendMail(payload.patientEmail, 'Thông báo dời lịch hẹn - UTE Doctor', html);
  }

  /** === RESCHEDULE: DOCTOR === */
  async sendDoctorRescheduleMail(payload: {
    doctorEmail: string;
    doctorName?: string;
    patientEmail: string;
    oldScheduledAt: number;
    newScheduledAt: number;
    newTimeSlotId: string;
    reason?: string;
  }) {
    const timeSlotName = await emitTyped<string, string>(
      this.eventEmitter,
      'timeslot.get.name.by.id',
      payload.newTimeSlotId,
    );
    const oldDateStr = new Date(payload.oldScheduledAt).toLocaleString('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      dateStyle: 'short',
      timeStyle: 'short',
    });
    const newDateStr = new Date(payload.newScheduledAt).toLocaleString('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      dateStyle: 'short',
      timeStyle: 'short',
    });

    const html = `
      <h2>Xin chào bác sĩ ${payload.doctorName || ''},</h2>
      <p>Bệnh nhân đã dời lịch hẹn.</p>
      <p><b>Bệnh nhân:</b> ${payload.patientEmail}</p>
      <p><b>Lịch cũ:</b> ${oldDateStr}</p>
      <p><b>Lịch mới:</b> ${newDateStr}${timeSlotName ? ` - ${timeSlotName}` : ''}</p>
      ${payload.reason ? `<p><b>Lý do:</b> ${payload.reason}</p>` : ''}
    `;

    await this.sendMail(payload.doctorEmail, 'Thông báo dời lịch hẹn - UTE Doctor', html);
  }

  async sendCoinExpiryReminderMail(payload: CoinExpiryReminderEventPayload) {
    const expiresAtIso = new Date(payload.expiresAt).toISOString();
    const remainingDaysText = payload.reminderDays > 1 ? `${payload.reminderDays} ngày` : '1 ngày';
    const html = `
      <h2>Xin chào ${payload.patientName || 'bạn'},</h2>
      <p>Bạn có ${payload.amount} coin sẽ hết hạn sau ${remainingDaysText}.</p>
      <p><b>Mã giao dịch:</b> ${payload.transactionId}</p>
      <p><b>Thời điểm hết hạn:</b> ${expiresAtIso}</p>
      <p>Vui lòng sử dụng coin trước thời điểm này để không bị mất giá trị thưởng.</p>
    `;

    await this.sendMail(payload.patientEmail, 'Coin sắp hết hạn - UTE Doctor', html);
  }
}
