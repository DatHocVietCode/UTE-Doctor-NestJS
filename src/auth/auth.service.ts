import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { console } from 'inspector';
import { Model } from 'mongoose';
import { AccountService } from 'src/account/account.service';
import { DataResponse } from 'src/common/dto/data-respone';
import { AccountStatusEnum } from 'src/common/enum/account-status.enum';
import { ResponseCode as rc } from 'src/common/enum/reponse-code.enum';
import { MailService } from 'src/mail/mail.service';
import { PatientService } from 'src/patient/patient.service';
import { OtpDTO } from 'src/utils/otp/otp-dto';
import { OtpUtils } from 'src/utils/otp/otp-utils';
import { Account } from '../account/schemas/account.schema';
import { LoginUserReqDto, LoginUserResDto, RegisterUserReqDto } from './dto/auth-user.dto';
import { DoctorService } from 'src/doctor/doctor.service';

@Injectable()
export class AuthService {
    constructor(@InjectModel(Account.name) private userModel: Model<Account>
                , private jwtService: JwtService
                ,@Inject(forwardRef(() => AccountService)) private userService: AccountService
                , private mailService: MailService
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

    // async register(registerUserDto: RegisterUserReqDto): Promise<string> {
    //     const hashedPassword = await bcrypt.hash(registerUserDto.password, 10);

    //     const createdUser = new this.userModel({
    //         email: registerUserDto.email,
    //         password: hashedPassword,
    //         role: registerUserDto.role,
    //     });

    //     try {
    //         const otpInfo = this.otpUtils.generateOTP();
    //         createdUser.otp = otpInfo.otp;
    //         createdUser.otpCreatedAt = otpInfo.otpCreatedAt;
    //         createdUser.otpExpiredAt = otpInfo.otpExpiredAt;
    //         this.mailService.sendOTP(createdUser.email, createdUser.otp);
    //         await createdUser.save();

    //         // Nếu là bệnh nhân → tạo Patient
    //         if (createdUser.role === "PATIENT") {
    //             await this.patientService.create({
    //                 accountId: createdUser._id.toString(),
    //                 height: registerUserDto.medicalRecord?.height,
    //                 weight: registerUserDto.medicalRecord?.weight,
    //                 bloodType: registerUserDto.medicalRecord?.bloodType,
    //                 medicalRecord: registerUserDto.medicalRecord,
    //             });
    //         }

    //         // Nếu là bác sĩ → tạo Doctor
    //         if (createdUser.role === "DOCTOR") {
    //             await this.doctorService.create({
    //                 accountId: createdUser._id.toString(),
    //                 chuyenKhoaId: registerUserDto.chuyenKhoaId,
    //                 degree: registerUserDto.degree,
    //                 yearsOfExperience: registerUserDto.yearsOfExperience,
    //             });
    //         }

    //         return "User registered successfully. Please verify your OTP to activate your account!";
    //     } catch (error) {
    //         return "Error registering user: " + error.message;
    //     }
    // }

    
    async login(loginUserDto: LoginUserReqDto): Promise<DataResponse<LoginUserResDto>> {
        const user = await this.userModel.findOne({ email: loginUserDto.email }).exec();
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

        const refreshTokenRespone = await this.userService.getAccountRefreshToken(user.email); 
        const accessToken = this.createAccessToken(user.email, user.role, user._id.toString());

        if (dataRes.data) {
            dataRes.data.accessToken = accessToken;
            dataRes.data.refreshToken = refreshTokenRespone?.data ?? "";
            dataRes.data.role = user.role;
            dataRes.data.id = user._id.toString();
        }

        return dataRes;
        }


    @OnEvent('otp.send')
    async handleOTPSending(email: string) : Promise<DataResponse<OtpDTO | null>>
    {
        let DataResponse: DataResponse = {
            code: rc.ERROR,
            message: "Server Error",
            data : null
        }
        const data = await this.userService.getAccountOTPInfor(email);
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
                    const newOTP: OtpDTO = this.otpUtils.generateOTP();
                    const dataRes = await this.userService.updateOTPByEmail(email, newOTP);
                    console.log(dataRes.message)
                    DataResponse.code = rc.SUCCESS;
                    DataResponse.message = "Sucessfully sent new otp!";
                    DataResponse.data = newOTP;

                    this.mailService.sendOTP(email, newOTP.otp); // ✅ thêm dòng này
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
        const otpInfo = await this.userService.getAccountOTPInfor(email);
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
                    await this.userService.activateAccount(email);
                    await this.userService.clearAccountOTP(email);
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