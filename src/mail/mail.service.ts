import { MailerService } from "@nestjs-modules/mailer";
import { Injectable } from "@nestjs/common";
import { EventEmitter2, OnEvent } from "@nestjs/event-emitter";
import type { AppointmentEnriched } from "src/appointment/schemas/appointment-enriched";
import { emitTyped } from "src/utils/helpers/event.helper";

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

    await this.mailerService.sendMail({
      to,
      subject,
      html,
      text: "This email is automatically sent by UTE-Doctor, please do not reply.",
    });

    console.log(`[MailService] Mail sent to ${to} | Subject: ${subject}`);
  }

  async sendAccountCreatedMail(payload: { toEmail: string; password: string }) {
    const { toEmail, password } = payload;
    const html = `
      <h2>Xin chào,</h2>
      <p>Tài khoản bác sĩ của bạn đã được tạo.</p>
      <p><b>Email:</b> ${toEmail}</p>
      <p><b>Mật khẩu tạm thời:</b> <code>${password}</code></p>
      <p>Vui lòng đăng nhập và đổi mật khẩu sau khi đăng nhập lần đầu.</p>
    `;

    await this.sendMail(toEmail, 'Tài khoản bác sĩ - UTE Doctor', html);
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
    let timeSlotName = '';
    timeSlotName = await emitTyped<string, string>(
        this.eventEmitter,
        'timeslot.get.name.by.id',
        payload.timeSlot._id.toString()
    );
    const html = `
      <h2>Xin chào ${payload.patientEmail},</h2>
      <p>Lịch hẹn của bạn đã được xác nhận thành công!</p>
      <p><b>Bác sĩ:</b> ${payload.doctorName}</p>
      <p><b>Thời gian:</b> ${payload.date} - ${timeSlotName}</p>
      <p>Địa điểm: ${payload.hospitalName}</p>
      <p>Cảm ơn bạn đã tin tưởng UTE Doctor!</p>
    `;
    await this.sendMail(payload.patientEmail, "Xác nhận lịch hẹn - UTE Doctor", html);
  }

  /** === BOOKING SUCCESS: DOCTOR === */
  async sendDoctorBookingSuccessMail(payload: AppointmentEnriched) {
    let timeSlotName = '';
    timeSlotName = await emitTyped<string, string>(
        this.eventEmitter,
        'timeslot.get.name.by.id',
        payload.timeSlot._id.toString() 
    );
    const html = `
      <h2>Xin chào bác sĩ ${payload.doctorName},</h2>
      <p>Bạn có lịch hẹn mới!</p>
      <p><b>Bệnh nhân:</b> ${payload.patientEmail}</p>
      <p><b>Thời gian:</b> ${payload.date} - ${timeSlotName}</p>
      <p>Địa điểm: ${payload.hospitalName}</p>
    `;
    await this.sendMail(payload.doctorEmail!, "Lịch hẹn mới - UTE Doctor", html); // When booking is successful, doctor email is guaranteed
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
}
