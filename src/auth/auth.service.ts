import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';
import { Model } from 'mongoose';
import { DataResponse } from 'src/common/dto/data-respone';
import { ResponseCode as rc } from 'src/common/enum/reponse-code-enum';
import { MailService } from 'src/mail/mail.service';
import { UserService } from 'src/users/user.service';
import { otpUtils } from 'src/utils/otp/otp-utils';
import { User, UserDocument } from '../users/schemas/user.schema';
import { LoginUserReqDto, LoginUserResDto, RegisterUserDto } from './dto/auth-user.dto';
import { OtpDTO } from 'src/utils/otp/otp-dto';
@Injectable()
export class AuthService {
    constructor(@InjectModel(User.name) private userModel: Model<UserDocument>
                , private jwtService: JwtService
                ,@Inject(forwardRef(() => UserService)) private userService: UserService
                , private configService: ConfigService
                , private mailService: MailService) {}

    async register(registerUserDto: RegisterUserDto): Promise<string> {
        const hashedPassword = await bcrypt.hash(registerUserDto.password, 10);
        const createdUser = new this.userModel({
            email: registerUserDto.email,
            password: hashedPassword,
        });
        try
        {
            const otp = otpUtils.generateOTP();
          
            const currentTime = Date.now();
            console.log("Current time: " + currentTime);
            const expiresTime = this.configService.get<string>('OTP_EXPIRES') || '5m';
            console.log("Expires In: " + expiresTime);
            const ms = require('ms');
            const expiresAt = currentTime + ms(expiresTime);
            console.log("Expire at: " + expiresAt);

            createdUser.otp = otp;
            createdUser.otpCreatedAt = new Date(currentTime);
            createdUser.otpExpiredAt = new Date(expiresAt);

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
        var dataRes: DataResponse<LoginUserResDto> = {
            code: rc.SERVER_ERROR,
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
        if (!user.isActive)
        {
            dataRes.message = "User is not activated! Automatically redirect you to verify OTP page..."
            // Implement check otp and resend if died
            dataRes.code = rc.ERROR;
            const data = await this.userService.getUserOTPInfor(loginUserDto.email);
            if (data.data)
            {
                const otpInfo: OtpDTO = data.data;
                otpUtils.isOTPValid(otpInfo);
                // if invalid, create a new one, else send it to user'email
            }
      
            return dataRes;
        }
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