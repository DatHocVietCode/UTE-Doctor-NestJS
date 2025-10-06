import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { OtpDTO } from './otp-dto';
import { OnEvent } from "@nestjs/event-emitter";

@Injectable()
export class OtpUtils {
    constructor(private configService: ConfigService) {}

    @OnEvent('otp.generateOtp')
    generateOTP(length: number = 6): OtpDTO {
        let otp = '';
        for (let i = 0; i < length; i++)
        {
            otp+= Math.floor(Math.random() * 10);
        }
        const currentTime = Date.now();
        console.log("Current time: " + currentTime);
        const expiresTime = this.configService.get<string>('OTP_EXPIRES') || '5m';
        console.log("Expires In: " + expiresTime);
        const ms = require('ms');
        const expiresAt = currentTime + ms(expiresTime);
        console.log("Expire at: " + expiresAt);
        
        const otpInfo: OtpDTO = {
            otp: otp,
            otpCreatedAt: new Date(currentTime),
            otpExpiredAt: expiresAt
        }
        return otpInfo;
    }

    @OnEvent('otp.is-Otp-alive')
    isOTPAlive(otpDTO: OtpDTO) : boolean
    {
        const currentTime = new Date(Date.now());
        return otpDTO.otpExpiredAt > currentTime;
    }
}