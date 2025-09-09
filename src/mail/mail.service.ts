import { MailerService } from "@nestjs-modules/mailer";
import { Injectable } from "@nestjs/common";


@Injectable()
export class MailService {
    constructor(private readonly mailerService: MailerService) {}

    async sendOTP(toEmail: string, otp: string) : Promise<string>
    {
        await this.mailerService.sendMail({
            to: toEmail,
            subject: "OTP Verification from UTE-Doctor",
            text: 'This email is automatically sent by UTE-Doctor, please no reply!',
            html: `<h1> Your OTP is: ${otp}</h1>`,
        });
        return otp;
    }
}