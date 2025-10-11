import { MailerService } from "@nestjs-modules/mailer";
import { Injectable } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";


@Injectable()
export class MailService {
    constructor(private readonly mailerService: MailerService) {}

   @OnEvent('mail.otp.send')
    async sendOTP(payload: { toEmail: string; otp: string }) {
        const { toEmail, otp } = payload;
        console.log(otp)
        if (!toEmail) {
            console.error('[Mail Listener] No email provided!');
            return;
        }

        await this.mailerService.sendMail({
            to: toEmail,
            subject: "OTP Verification from UTE-Doctor",
            text: 'This email is automatically sent by UTE-Doctor, please no reply!',
            html: `<h1>Your OTP is: ${otp}</h1>`,
        });
        console.log(`[Mail Listener] OTP sent to ${toEmail}`);
        return otp;
    }

    @OnEvent('patient.notify')
    sendPatientMail(email: string) { 

    } 

    @OnEvent('doctor.notify')
    sendDoctorMail(doctorId: string) {  } // TODO: implement later

}