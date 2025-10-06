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
import * as jwt from "jsonwebtoken";
import { OtpDTO } from 'src/utils/otp/otp-dto';
import { OtpUtils } from 'src/utils/otp/otp-utils';
import { Account, AccountDocument } from '../account/schemas/account.schema';
import { LoginUserReqDto, LoginUserResDto, RegisterUserReqDto } from './dto/auth-user.dto';
import { emitTyped } from 'src/utils/helpers/event.helper';


@Injectable()
export class AuthService {
    constructor(@InjectModel(Account.name) private accountModel: Model<Account>
                , private jwtService: JwtService
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

        const refreshTokenRespone = await this.getAccountRefreshToken(user.email); 
        const accessToken = this.createAccessToken(user.email, user.role, user._id.toString());

        if (dataRes.data) {
            dataRes.data.accessToken = accessToken;
            dataRes.data.refreshToken = refreshTokenRespone?.data ?? "";
            dataRes.data.role = user.role;
            dataRes.data.id = user._id.toString();
        }

        return dataRes;
    }

    async getAccountOTPInfor(email: string) : Promise<DataResponse<OtpDTO | null>> {
        let dataRes: DataResponse<OtpDTO | null> = 
        {
            message: "",
            code: rc.ERROR,
            data: null
        };
        try {
            const account = await emitTyped<{ email: string }, Account | null>(
            this.eventEmitter,
            'account.find.by.email',
            { email }
            );
            if (!account)
            {
                dataRes.message = "Account not found!",
                dataRes.code =  rc.ACCOUNT_NOT_FOUND
            }
            else
            {
                dataRes.message = "OTP received successfully",
                dataRes.code = rc.SUCCESS,
                dataRes.data = {
                    otp: account.otp,
                    otpCreatedAt: account.otpCreatedAt,
                    otpExpiredAt: account.otpExpiredAt
                }
            }
        } catch (error) {
            console.log("Server error:" + error);
            dataRes.code = rc.SERVER_ERROR;
            dataRes.message = error;
            dataRes.data = null;
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
        const data = await this.getAccountOTPInfor(email);
            if (data.data)
            {
                const otpInfo: OtpDTO = data.data;
                const [isValid] = await this.eventEmitter.emitAsync('otp.is-Otp-alive', {otpInfo});

                // if invalid, create a new one, else send it to user'email
                if (isValid)
                {
                    DataResponse.data = otpInfo;
                    DataResponse.message = "Succesfully resent otp!";
                    DataResponse.code = rc.SUCCESS;
                    this.eventEmitter.emit('mail.otp.send', {toEmail: email, otp: otpInfo.otp});
                }
                else
                {
                    //const newOTP: OtpDTO = this.otpUtils.generateOTP();
                    const [newOTP] = await this.eventEmitter.emitAsync('otp.generateOtp') as [OtpDTO];
                    const dataRes = await this.updateOTPByEmail(email, newOTP);
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
        const otpInfo = await this.getAccountOTPInfor(email);
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
                const isOTPAlive = await emitTyped<OtpDTO, boolean>(
                this.eventEmitter,
                'otp.is-Otp-alive',
                otpInfo.data
                );
                if (isOTPAlive && isOtpMatched)
                {
                    await this.activateAccount(email);
                    await this.clearAccountOTP(email);
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

    async activateAccount(email: string): Promise<DataResponse<null>> {
        let dataRes: DataResponse<null> = {
            code: rc.ERROR,
            message: "Account not found",
            data: null
        };
        
        try {
            const account = await this.accountModel.findOne({ email }).exec();
            if (!account) {
            dataRes.message = "Account not found!";
            dataRes.code = rc.ACCOUNT_NOT_FOUND;
            return dataRes;
            }

            account.status = AccountStatusEnum.ACTIVE; // kích hoạt tài khoản
            await account.save();

            dataRes.code = rc.SUCCESS;
            dataRes.message = "Account activated successfully!";
            return dataRes;
        } catch (error) {
            dataRes.code = rc.SERVER_ERROR;
            dataRes.message = error.message;
            return dataRes;
        }
    }

    
    async clearAccountOTP(email: string): Promise<Account | null> {
        return this.accountModel
            .findOneAndUpdate(
                { email },
                { otp: null, otpCreatedAt: null, otpExpiredAt: null },
                { new: true }
            )
            .exec();
    }

    async updateOTPByEmail(email: string, otpDTO: OtpDTO): Promise<DataResponse<null>>
    {
        let data: DataResponse = {
            message: "Updated otp failed for Account with email: " + email,
            code: rc.ERROR,
            data: null
        }
        const updatedAccount = await this.accountModel.findOneAndUpdate({email: email}, otpDTO, {new: true}).exec();
        if (updatedAccount)
        {

            data.message = "OTP updated for Account with email: " + email;
            data.code = rc.SUCCESS;
            console.log(updatedAccount);
        }
        return data;
    }

    async getAccountRefreshToken(email: string) : Promise<DataResponse<string>>
    {
        const account = await this.accountModel.findOne({email});
        const dataRes: DataResponse= {
            message: "",
            code: rc.SERVER_ERROR,
            data: ""
        }
        if (!account)
        {
            dataRes.code = rc.ACCOUNT_NOT_FOUND;
            dataRes.message = "Account not found";
        }
        else
        {
            if (account.refreshToken)
            {
                if (this.isTokenAlive(account.refreshToken))
                {
                    dataRes.code = rc.SUCCESS;
                    dataRes.message = "Successfully get refresh token";
                    dataRes.data = account.refreshToken;
                }
            }
            else
            {
                const newRefreshToken = this.createRefreshToken(email);
                account.refreshToken = newRefreshToken;
                await account.save();
                dataRes.code = rc.SUCCESS;
                dataRes.message = "Successfully create new refresh token";
                dataRes.data = newRefreshToken;
            }
        }
        return dataRes;
    }

    isTokenAlive(token: string) : boolean
    {
        try
        {
            const decode = jwt.decode(token) as { exp?: number } | null;
            if (!decode || !decode.exp)
            {
                return false;
            }
            else
            {
                const currentTime = Math.floor(Date.now() / 1000);
                return decode.exp > currentTime;
            }
        }
        catch (error)
        {
            console.log("Error while checking token life time: " + error);
            return false;
        }
    }
}