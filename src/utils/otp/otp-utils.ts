import { OtpDTO } from "./otp-dto";

export class otpUtils {

    static generateOTP(length: number = 6): string{
        let otp = '';
        for (let i = 0; i < length; i++)
        {
            otp+= Math.floor(Math.random() * 10);
        }
        return otp;
    }

    static isOTPValid(otpDTP: OtpDTO) : boolean
    {
        const currentTime = new Date(Date.now());
        return otpDTP.OTPExpiredAt > currentTime;
    }
}