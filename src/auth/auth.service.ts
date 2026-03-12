import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';
import { console } from 'inspector';
import * as jwt from "jsonwebtoken";
import { Model } from 'mongoose';
import { DataResponse } from 'src/common/dto/data-respone';
import { AccountStatusEnum } from 'src/common/enum/account-status.enum';
import { ResponseCode as rc } from 'src/common/enum/reponse-code.enum';
import { RoleEnum } from 'src/common/enum/role.enum';
import { UserContextService } from 'src/user-context/user-context.service';
import { emitTyped } from 'src/utils/helpers/event.helper';
import { OtpDTO } from 'src/utils/otp/otp-dto';
import { AccountService } from '../account/account.service';
import { Account } from '../account/schemas/account.schema';
import { DoctorService } from '../doctor/doctor.service';
import { CreatePatientDto } from '../patient/dto/create-patient.dto';
import { PatientService } from '../patient/patient.service';
import { CreateProfileDto } from '../profile/dto/create-profile.dto';
import { ProfileService } from '../profile/profile.service';
import { LoginUserReqDto, LoginUserResDto, RegisterUserReqDto } from './dto/auth-user.dto';

@Injectable()
export class AuthService {
    constructor(@InjectModel(Account.name) private accountModel: Model<Account>
                , private jwtService: JwtService
                , private readonly eventEmitter: EventEmitter2
                , private userContextService: UserContextService
                , private readonly accountService: AccountService
                , private readonly profileService: ProfileService
                , private readonly patientService: PatientService
                , private readonly doctorService: DoctorService
            ) {
                console.log('AuthService instantiated');
            }
     private readonly logger = new Logger(AuthService.name);

    async register(registerUser: RegisterUserReqDto): Promise<DataResponse> {
        this.logger.log(`[Register] Start registration for ${registerUser.email}`);

        // Step 1: Create Account
        const createdAccountRes = await this.accountService.createAccount(registerUser);
        if (createdAccountRes.code !== rc.SUCCESS) {
            return { code: rc.ERROR, message: createdAccountRes.message, data: null };
        }
        const accountId = createdAccountRes.data!._id.toString();
        this.logger.log(`[Register] Account created → ${accountId}`);

        // Step 2: Create Profile
        const createProfileDto: CreateProfileDto = {
            email: registerUser.email,
        };
        const createdProfileRes = await this.profileService.createProfile(createProfileDto);
        if (createdProfileRes.code !== rc.SUCCESS) {
            await this.accountService.deleteByEmail(registerUser.email);
            return { code: rc.ERROR, message: createdProfileRes.message, data: null };
        }
        const profileId = createdProfileRes.data!._id.toString();
        this.logger.log(`[Register] Profile created → ${profileId}`);

        // Step 3: Link Profile to Account
        const linkRes = await this.accountService.handleLinkProfile({ accountId, profileId });
        if (linkRes.code !== rc.SUCCESS) {
            await this.accountService.deleteByEmail(registerUser.email);
            return { code: rc.ERROR, message: linkRes.message, data: null };
        }
        this.logger.log(`[Register] Linked Profile to Account`);

        // Step 4: Create child entity (Patient / Doctor)
        const role = registerUser.role ?? RoleEnum.PATIENT;
        if (role === RoleEnum.PATIENT) {
            const createPatientDto: CreatePatientDto = {
                accountId,
                profileId,
            };
            const patientRes = await this.patientService.createPatient(createPatientDto);
            if (patientRes.code !== rc.SUCCESS) {
                await this.accountService.deleteByEmail(registerUser.email);
                return { code: rc.ERROR, message: patientRes.message, data: null };
            }
            this.logger.log(`[Register] Patient created`);
        } else if (role === RoleEnum.DOCTOR) {
            const createDoctorDto: any = {
                profileId,
                chuyenKhoaId: registerUser.chuyenKhoaId,
                degree: registerUser.degree,
                yearsOfExperience: registerUser.yearsOfExperience,
            };
            const doctorRes = await this.doctorService.createDoctor(createDoctorDto);
            if (doctorRes.code !== rc.SUCCESS) {
                await this.accountService.deleteByEmail(registerUser.email);
                return { code: rc.ERROR, message: doctorRes.message, data: null };
            }
            this.logger.log(`[Register] Doctor created`);
        }

        // Step 5: Send OTP (fire-and-forget, don't block response)
        this.handleOTPSending(registerUser.email).catch(err =>
            this.logger.error(`[Register] Failed to send OTP: ${err.message}`),
        );

        this.logger.log(`[Register] Registration completed for ${registerUser.email}`);
        return {
            code: rc.SUCCESS,
            message: 'User registered successfully',
            data: null,
        };
    }
    
    async login(loginUserDto: LoginUserReqDto): Promise<DataResponse<LoginUserResDto>> {

        this.logger.log(">>> BEFORE FIND ONE");
        const user = await this.accountModel.findOne({ email: loginUserDto.email }).exec();

        this.logger.log("Found user:", user?.email);

        let dataRes: DataResponse<LoginUserResDto> = {
            code: rc.ACCOUNT_NOT_FOUND,
            message: "",
            data: { accessToken: "", refreshToken: "", role: "", id: "" }
        };

        if (!user) {
            dataRes.message = "User not found";
            dataRes.code = rc.ACCOUNT_NOT_FOUND;
            this.logger.log(dataRes.message);
            return dataRes;
        }
        
        const isPasswordValid = await bcrypt.compare(loginUserDto.password, user.password);
        if (!isPasswordValid) {
            dataRes.message = "Invalid password";
            dataRes.code = rc.ERROR;
            this.logger.log(dataRes.message);
            return dataRes;
        }

        if (user.status === AccountStatusEnum.INACTIVE) {
            dataRes.message = "User is not activated! Automatically redirect you to verify OTP page...";
            dataRes.code = rc.ERROR;
            this.logger.log(dataRes.message);
            await this.handleOTPSending(loginUserDto.email);
            return dataRes;
        }

        // Login thành công
        dataRes.code = rc.SUCCESS;
        dataRes.message = "Login Successful";

        console.log("Creating tokens for user:", user.email);

        const refreshTokenRespone = await this.getAccountRefreshToken(user.email); 
        this.logger.log("Refresh token response:", refreshTokenRespone);
        const userCtx = await this.userContextService.getUserContext(user);
        const accessToken = this.createAccessToken(user, userCtx);

        if (dataRes.data) {
            dataRes.data.accessToken = accessToken;
            dataRes.data.refreshToken = refreshTokenRespone?.data ?? "";
            dataRes.data.role = user.role;
            dataRes.data.id = user._id.toString();
            dataRes.data.patientId = userCtx.patientId ?? undefined;
            dataRes.data.doctorId = userCtx.doctorId ?? undefined;
            dataRes.data.profileId = userCtx.profileId ? userCtx.profileId.toString() : undefined;
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

    // createAccessToken(email: string, role: string, id: string): string {
    //     // Implement JWT token creation logic here
    //     const payload = { sub: email, role, id };
    //     console.log("Creating access token with payload:", payload);
    //     const token = this.jwtService.sign(payload, 
    //         {
    //             secret: process.env.JWT_SECRET,
    //             expiresIn: process.env.JWT_EXPIRES_IN
    //         }
    //     );
    //     return token;
    // }

    createAccessToken(user: Account, ctx: any): string {
    const payload = {
        sub: user._id.toString(),
        email: user.email,
        role: user.role,
        accountId: user._id.toString(),

        // từ userContext
        patientId: ctx.patientId ?? null,
        doctorId: ctx.doctorId ?? null,
        profileId: ctx.profileId ? ctx.profileId.toString() : null
    };

    console.log("Creating access token with payload:", payload);

    return this.jwtService.sign(payload, {
        secret: process.env.JWT_SECRET,
        expiresIn: process.env.JWT_EXPIRES_IN
    });
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

    async getAccountRefreshToken(email: string) {
        const account = await this.accountModel.findOne({ email });
        const dataRes: DataResponse<string> = { code: rc.SERVER_ERROR, message: "", data: "" };

        if (!account) {
            dataRes.code = rc.ACCOUNT_NOT_FOUND;
            dataRes.message = "Account not found";
            // this.logger.warn(dataRes.message);  // Dùng logger thay vì console.log
        } else {
        if (account.refreshToken && this.isTokenAlive(account.refreshToken)) {
            dataRes.code = rc.SUCCESS;
            dataRes.message = "Successfully get refresh token";
            dataRes.data = account.refreshToken;
            // this.logger.log(dataRes.message);
        } else {
            const newRefreshToken = this.createRefreshToken(email);
            account.refreshToken = newRefreshToken;
            await account.save();
            dataRes.code = rc.SUCCESS;
            dataRes.message = "Successfully create new refresh token";
            dataRes.data = newRefreshToken;
            // this.logger.log(dataRes.message);
            // this.logger.debug("New refresh token: " + newRefreshToken);
        }
        }

        // this.logger.debug(`dataRes.data: ${dataRes.data}`);
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

    async refresh(refreshToken: string): Promise<DataResponse<LoginUserResDto>> {
        const dataRes: DataResponse<LoginUserResDto> = {
            code: rc.ERROR,
            message: 'Invalid refresh token',
            data: { accessToken: '', refreshToken: '', role: '', id: '' },
        };

        try {
            if (!refreshToken) {
                dataRes.message = 'Missing refresh token';
                return dataRes;
            }

            // 1. Verify refresh token
            let payload: any;
            try {
                console.log("Verifying refresh token", refreshToken);
                payload = await this.jwtService.verifyAsync(refreshToken, { 
                    secret: process.env.JWT_REFRESH_SECRET 
                });
            } catch (err) {
                dataRes.message = 'Refresh token invalid or expired';
                return dataRes;
            }

            const email = payload?.sub;
            if (!email) {
                dataRes.message = 'Invalid token payload';
                return dataRes;
            }

            // 2. Find account by email
            const account = await this.accountModel.findOne({ email }).exec();
            if (!account) {
                dataRes.message = 'Account not found';
                dataRes.code = rc.ACCOUNT_NOT_FOUND;
                return dataRes;
            }

            // 3. Ensure refresh token matches DB
            if (!account.refreshToken || account.refreshToken !== refreshToken) {
                dataRes.message = 'Refresh token does not match';
                return dataRes;
            }

            // 4. Load userContext (patientId / doctorId / profileId)
            const userCtx = await this.userContextService.getUserContext(account);

            // 5. Create new access token (full info)
            const accessToken = this.createAccessToken(account, userCtx);

            // 6. Build response
            dataRes.code = rc.SUCCESS;
            dataRes.message = 'Access token refreshed';

            dataRes.data = {
                accessToken,
                refreshToken: account.refreshToken,   // giữ refresh token cũ
                role: account.role,
                id: account._id.toString(),
                patientId: userCtx.patientId ?? undefined,
                doctorId: userCtx.doctorId ?? undefined,
                profileId: userCtx.profileId ? userCtx.profileId.toString() : undefined
            };

            return dataRes;

        } catch (error) {
            console.error('[AuthService] Error refreshing token', error);
            dataRes.message = 'Server error while refreshing token';
            return dataRes;
        }
    }

}