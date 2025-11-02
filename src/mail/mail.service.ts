import { MailerService } from "@nestjs-modules/mailer";
import { Injectable } from "@nestjs/common";
import { EventEmitter2, OnEvent } from "@nestjs/event-emitter";
import { AppointmentBookingDto } from "src/appointment/dto/appointment-booking.dto";
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
  async sendPatientBookingSuccessMail(payload: AppointmentBookingDto) {
    let timeSlotName = '';
    timeSlotName = await emitTyped<string, string>(
        this.eventEmitter,
        'timeslot.get.name.by.id',
        payload.timeSlotId!
    );
    const html = `
      <h2>Xin chào ${payload.patientEmail},</h2>
      <p>Lịch hẹn của bạn đã được xác nhận thành công!</p>
      <p><b>Bác sĩ:</b> ${payload.doctor?.name}</p>
      <p><b>Thời gian:</b> ${payload.date} - ${timeSlotName}</p>
      <p>Địa điểm: ${payload.hospitalName}</p>
      <p>Cảm ơn bạn đã tin tưởng UTE Doctor!</p>
    `;
    await this.sendMail(payload.patientEmail, "Xác nhận lịch hẹn - UTE Doctor", html);
  }

  /** === BOOKING SUCCESS: DOCTOR === */
  async sendDoctorBookingSuccessMail(payload: AppointmentBookingDto) {
    let timeSlotName = '';
    timeSlotName = await emitTyped<string, string>(
        this.eventEmitter,
        'timeslot.get.name.by.id',
        payload.timeSlotId!
    );
    const html = `
      <h2>Xin chào bác sĩ ${payload.doctor?.name},</h2>
      <p>Bạn có lịch hẹn mới!</p>
      <p><b>Bệnh nhân:</b> ${payload.patientEmail}</p>
      <p><b>Thời gian:</b> ${payload.date} - ${timeSlotName}</p>
      <p>Địa điểm: ${payload.hospitalName}</p>
    `;
    await this.sendMail(payload.doctor!.email, "Lịch hẹn mới - UTE Doctor", html); // When booking is successful, doctor email is guaranteed
  }
}
