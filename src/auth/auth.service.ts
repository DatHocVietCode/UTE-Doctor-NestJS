import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';
import { console } from 'inspector';
import { Model } from 'mongoose';
import { DataResponse } from 'src/common/dto/data-respone';
import { ResponseCode as rc } from 'src/common/enum/reponse-code-enum';
import { MailService } from 'src/mail/mail.service';
import { UserService } from 'src/users/user.service';
import { OtpDTO } from 'src/utils/otp/otp-dto';
import { OtpUtils } from 'src/utils/otp/otp-utils';
import { User, UserDocument } from '../users/schemas/user.schema';
import { LoginUserReqDto, LoginUserResDto, RegisterUserDto } from './dto/auth-user.dto';
import { AccountStatusEnum } from 'src/common/enum/account-status-enum';
@Injectable()
export class AuthService {
    constructor(@InjectModel(User.name) private userModel: Model<UserDocument>
                , private jwtService: JwtService
                ,@Inject(forwardRef(() => UserService)) private userService: UserService
                , private configService: ConfigService
                , private mailService: MailService
                , private otpUtils: OtpUtils) {}

    async register(registerUserDto: RegisterUserDto): Promise<string> {
        const hashedPassword = await bcrypt.hash(registerUserDto.password, 10);
        const createdUser = new this.userModel({
            email: registerUserDto.email,
            password: hashedPassword,
            fullName: registerUserDto.fullName,
            dob: new Date(registerUserDto.dob),
            phoneNumber: registerUserDto.phoneNumber,
        });
        try
        {
            const otpInfo = this.otpUtils.generateOTP();
          
            createdUser.otp = otpInfo.otp;
            createdUser.otpCreatedAt = otpInfo.otpCreatedAt;
            createdUser.otpExpiredAt = otpInfo.otpExpiredAt;

            this.mailService.sendOTP(createdUser.email, createdUser.otp);

            await createdUser.save();

            return "User registered successfully. Please verify your OTP to activate your account!";
        }
        catch (error)
        {
            return "Error registering user: " + error.message;
        }
    }

    async login(loginUserDto: LoginUserReqDto): Promise<DataResponse<LoginUserResDto>> {
        const user = await this.userModel.findOne({ email: loginUserDto.email }).exec();
        let dataRes: DataResponse<LoginUserResDto> = {
            code: rc.USER_NOT_FOUND,
            message: "",
            data: { accessToken: "", refreshToken: "" }
        };
        if (!user) {
            dataRes.message = "User not found";
            dataRes.code = rc.USER_NOT_FOUND;
            return dataRes;
        }
        
        const isPasswordValid = await bcrypt.compare(loginUserDto.password, user.password);
        if (!isPasswordValid) {
            dataRes.message = "Invalid password";
            dataRes.code = rc.ERROR;
            return dataRes;
        }
        if (user.status === AccountStatusEnum.INACTIVE)
        {
            dataRes.message = "User is not activated! Automatically redirect you to verify OTP page..."
            // Implement check otp and resend if died
            dataRes.code = rc.ERROR;
            await this.handleOTPSending(loginUserDto.email);
            // if (data.data)
            // {
            //     const otpInfo: OtpDTO = data.data;
            //     const isValid: boolean = this.otpUtils.isOTPValid(otpInfo);
            //     // if invalid, create a new one, else send it to user'email
            //     if (isValid)
            //     {
            //         this.mailService.sendOTP(loginUserDto.email, otpInfo.otp);
            //     }
            //     else
            //     {
            //         const newOTP = this.otpUtils.generateOTP();
            //         const dataRes = await this.userService.updateOTPByEmail(loginUserDto.email, newOTP);
            //         console.log((await dataRes).message)
            //     }
            // }
            return dataRes;
        }
        dataRes.code = rc.SUCCESS;
        dataRes.message = "Login Successful";
        const refreshTokenRespone = await this.userService.getUserRefreshToken(user.email); 
        console.log(refreshTokenRespone.data)
        const accessToken = await this.createAccessToken(loginUserDto.email);
        if (dataRes.data)
        {
            dataRes.data.accessToken = accessToken;
            if (refreshTokenRespone)
            {
                if (refreshTokenRespone.data)
                    dataRes.data.refreshToken = refreshTokenRespone.data;
            }
        }
        return dataRes;
    }



    async handleOTPSending(email: string) : Promise<DataResponse<OtpDTO | null>>
    {
        let DataResponse: DataResponse = {
            code: rc.ERROR,
            message: "Server Error",
            data : null
        }
        const data = await this.userService.getUserOTPInfor(email);
            if (data.data)
            {
                const otpInfo: OtpDTO = data.data;
                const isValid: boolean = this.otpUtils.isOTPAlive(otpInfo);
                // if invalid, create a new one, else send it to user'email
                if (isValid)
                {
                    DataResponse.data = otpInfo;
                    DataResponse.message = "Succesfully resent otp!";
                    DataResponse.code = rc.SUCCESS;
                    this.mailService.sendOTP(email, otpInfo.otp);
                }
                else
                {
                    const newOTP = this.otpUtils.generateOTP();
                    const dataRes = await this.userService.updateOTPByEmail(email, newOTP);
                    console.log(dataRes.message)
                    DataResponse.code = rc.SUCCESS;
                    DataResponse.message = "Sucessfully sent new otp!";
                    DataResponse.data = newOTP;
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
        const otpInfo = await this.userService.getUserOTPInfor(email);
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
                    await this.userService.activateUserAccount(email);
                    await this.userService.clearUserOTP(email);
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

    createAccessToken(email: string): string {
        // Implement JWT token creation logic here
        const payload = { sub: email };
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