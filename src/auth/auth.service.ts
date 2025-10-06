import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';
import { console } from 'inspector';
import { Model } from 'mongoose';
import { AccountService } from 'src/account/account.service';
import { DataResponse } from 'src/common/dto/data-respone';
import { AccountStatusEnum } from 'src/common/enum/account-status.enum';
import { ResponseCode as rc } from 'src/common/enum/reponse-code.enum';
import { MailService } from 'src/mail/mail.service';
import { OtpDTO } from 'src/utils/otp/otp-dto';
import { OtpUtils } from 'src/utils/otp/otp-utils';
import { Account } from '../account/schemas/account.schema';
import { LoginUserReqDto, LoginUserResDto, RegisterUserReqDto } from './dto/auth-user.dto';


@Injectable()
export class AuthService {
    constructor(@InjectModel(Account.name) private accountModel: Model<Account>
                , private jwtService: JwtService
                ,@Inject(forwardRef(() => AccountService)) private accountService: AccountService
                , private otpUtils: OtpUtils
                , private readonly eventEmitter: EventEmitter2) {}
    
    async register(registerUser: RegisterUserReqDto) {
        // bắn event "đăng ký yêu cầu"
        this.eventEmitter.emitAsync('user.register.requested', {
            registerUser: registerUser,
        });
        const responseData : DataResponse = {
            code: rc.PENDING,
            message: "Received user register request",
            data: null
        }
        // trả requestId ngay cho client
        return responseData;
    }
    
    async login(loginUserDto: LoginUserReqDto): Promise<DataResponse<LoginUserResDto>> {
        const user = await this.accountModel.findOne({ email: loginUserDto.email }).exec();
        let dataRes: DataResponse<LoginUserResDto> = {
            code: rc.ACCOUNT_NOT_FOUND,
            message: "",
            data: { accessToken: "", refreshToken: "", role: "", id: "" }
        };

        if (!user) {
            dataRes.message = "User not found";
            dataRes.code = rc.ACCOUNT_NOT_FOUND;
            return dataRes;
        }
        
        const isPasswordValid = await bcrypt.compare(loginUserDto.password, user.password);
        if (!isPasswordValid) {
            dataRes.message = "Invalid password";
            dataRes.code = rc.ERROR;
            return dataRes;
        }

        if (user.status === AccountStatusEnum.INACTIVE) {
            dataRes.message = "User is not activated! Automatically redirect you to verify OTP page...";
            dataRes.code = rc.ERROR;
            await this.handleOTPSending(loginUserDto.email);
            return dataRes;
        }

        // Login thành công
        dataRes.code = rc.SUCCESS;
        dataRes.message = "Login Successful";

        const refreshTokenRespone = await this.accountService.getAccountRefreshToken(user.email); 
        const accessToken = this.createAccessToken(user.email, user.role, user._id.toString());

        if (dataRes.data) {
            dataRes.data.accessToken = accessToken;
            dataRes.data.refreshToken = refreshTokenRespone?.data ?? "";
            dataRes.data.role = user.role;
            dataRes.data.id = user._id.toString();
        }

        return dataRes;
    }


    @OnEvent('handle-otp.send')
    async handleOTPSending(email: string) : Promise<DataResponse<OtpDTO | null>>
    {
        let DataResponse: DataResponse = {
            code: rc.ERROR,
            message: "Server Error",
            data : null
        }
        const data = await this.accountService.getAccountOTPInfor(email);
            if (data.data)
            {
                const otpInfo: OtpDTO = data.data;
                //const isValid: boolean = this.otpUtils.isOTPAlive(otpInfo);
                const [isValid] = await this.eventEmitter.emitAsync('otp.is-Otp-alive', {otpInfo});
                
                // if invalid, create a new one, else send it to user'email
                if (isValid)
                {
                    DataResponse.data = otpInfo;
                    DataResponse.message = "Succesfully resent otp!";
                    DataResponse.code = rc.SUCCESS;
                    //this.mailService.sendOTP(email, otpInfo.otp);
                    this.eventEmitter.emit('mail.otp.send', {toEmail: email, otp: otpInfo.otp});
                }
                else
                {
                    const newOTP: OtpDTO = this.otpUtils.generateOTP();
                    const dataRes = await this.accountService.updateOTPByEmail(email, newOTP);
                    console.log(dataRes.message)
                    DataResponse.code = rc.SUCCESS;
                    DataResponse.message = "Sucessfully sent new otp!";
                    DataResponse.data = newOTP;

                    //this.mailService.sendOTP(email, newOTP.otp);
                    this.eventEmitter.emit('mail.otp.send', {toEmail: email, otp: newOTP.otp});
                }
            }
        return DataResponse;
    }

    async verifyOTP(email:string, otp: string) : Promise<DataResponse<null>>
    {
        debugger;
        let dataRes: DataResponse = {
            code: rc.ERROR,
            message: "OTP invalid or not exist!",
            data: null
        }
        const otpInfo = await this.accountService.getAccountOTPInfor(email);
        if (otpInfo)
        {
            let isOtpMatched: Boolean = false;
            if (otpInfo.data?.otp == otp)
            {
                isOtpMatched = true;
                console.log("OTP is matched!")
            }
            if (otpInfo.data)
            {
                const isOTPAlive = this.otpUtils.isOTPAlive(otpInfo.data);
                if (isOTPAlive && isOtpMatched)
                {
                    await this.accountService.activateAccount(email);
                    await this.accountService.clearAccountOTP(email);
                    dataRes.code = rc.SUCCESS;
                    dataRes.message = "OTP verify successfully!";
                }
                else
                {
                    dataRes.code = rc.ERROR;
                    dataRes.message = "OTP is died or not matched!"
                }
            }
        }   
        return dataRes;
    }

    createAccessToken(email: string, role: string, id: string): string {
        // Implement JWT token creation logic here
        const payload = { sub: email, role, id };
        console.log("Creating access token with payload:", payload);
        const token = this.jwtService.sign(payload, 
            {
                secret: process.env.JWT_SECRET,
                expiresIn: process.env.JWT_EXPIRES_IN
            }
        );
        return token;
    }

    createRefreshToken(email: string): string {
        // Implement JWT refresh token creation logic here
        const payload = { sub: email };
        console.log("Creating refresh token with payload:", payload);
        const refreshToken = this.jwtService.sign(payload, 
            {
                secret: process.env.JWT_REFRESH_SECRET,
                expiresIn: process.env.JWT_REFRESH_EXPIRES_IN
            }
        );
        return refreshToken;
    }
}