import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';
import * as jwt from "jsonwebtoken";
import { Model } from 'mongoose';
import { AuthService } from 'src/auth/auth.service';
import { DataResponse } from 'src/common/dto/data-respone';
import { AccountStatusEnum } from 'src/common/enum/account-status.enum';
import { ResponseCode as rc } from 'src/common/enum/reponse-code.enum';
import { OtpDTO } from 'src/utils/otp/otp-dto';
import { UserProfileDTO } from './dto/user.dto';
import { User, UserDocument } from './schemas/user.schema';
@Injectable()
export class UserService {
    constructor(@InjectModel(User.name) private userModel: Model<UserDocument>
                , private readonly authService: AuthService) {}

    async findAll(): Promise<User[]> {
        return this.userModel.find().exec();
    }

    async findOne(id: string): Promise<User | null> {
        return this.userModel.findById(id).exec();
    }

    async findByEmail(email: string): Promise<User | null> {
        console.log("Finding user by email: " + email);
        return this.userModel.findOne({ email: email }).lean().exec();
    }

    async update(id: string, updateUserDto: Partial<User>): Promise<User | null> {
        if (updateUserDto.password) {
            updateUserDto.password = await bcrypt.hash(updateUserDto.password, 10);
        }
        return this.userModel
            .findByIdAndUpdate(id, updateUserDto, { new: true })
            .exec();
    }

    async activateUserAccount(email: string): Promise<DataResponse<null>> {
        let dataRes: DataResponse<null> = {
            code: rc.ERROR,
            message: "User not found",
            data: null
        };

        
        try {
            const user = await this.userModel.findOne({ email }).exec();
            if (!user) {
            dataRes.message = "User not found!";
            dataRes.code = rc.USER_NOT_FOUND;
            return dataRes;
            }

            user.status = AccountStatusEnum.ACTIVE; // kích hoạt tài khoản
            await user.save();

            dataRes.code = rc.SUCCESS;
            dataRes.message = "User activated successfully!";
            return dataRes;
        } catch (error) {
            dataRes.code = rc.SERVER_ERROR;
            dataRes.message = error.message;
            return dataRes;
        }
    }

    
    async clearUserOTP(email: string): Promise<User | null> {
        return this.userModel
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
            message: "Updated otp failed for user with email: " + email,
            code: rc.ERROR,
            data: null
        }
        const updatedUser = await this.userModel.findOneAndUpdate({email: email}, otpDTO, {new: true}).exec();
        if (updatedUser)
        {

            data.message = "OTP updated for user with email: " + email;
            data.code = rc.SUCCESS;
            console.log(updatedUser);
        }
        return data;
    }

    async remove(id: string): Promise<User | null> {
        return this.userModel.findByIdAndDelete(id).exec();
    }

    async getUserRefreshToken(email: string) : Promise<DataResponse<string>>
    {
        const user = await this.userModel.findOne({email});
        const dataRes: DataResponse= {
            message: "",
            code: rc.SERVER_ERROR,
            data: ""
        }
        if (!user)
        {
            dataRes.code = rc.USER_NOT_FOUND;
            dataRes.message = "User not found";
        }
        else
        {
            if (user.refreshToken)
            {
                if (this.isTokenAlive(user.refreshToken))
                {
                    dataRes.code = rc.SUCCESS;
                    dataRes.message = "Successfully get refresh token";
                    dataRes.data = user.refreshToken;
                }
            }
            else
            {
                const newRefreshToken = this.authService.createRefreshToken(email);
                user.refreshToken = newRefreshToken;
                await user.save();
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


    /**
     * 
     * @param email input user's email
     * @returns DataResponse<OtpDTO>, include otp, created and expired time.
     */
    async getUserOTPInfor(email: string) : Promise<DataResponse<OtpDTO | null>> {
        let dataRes: DataResponse<OtpDTO | null> = 
        {
            message: "",
            code: rc.ERROR,
            data: null
        };
        try {
            const user = await this.findByEmail(email);
            if (!user)
            {
                dataRes.message = "User not found!",
                dataRes.code =  rc.USER_NOT_FOUND
            }
            else
            {
                dataRes.message = "OTP received successfully",
                dataRes.code = rc.SUCCESS,
                dataRes.data = {
                    otp: user.otp,
                    otpCreatedAt: user.otpCreatedAt,
                    otpExpiredAt: user.otpExpiredAt
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
    async getUserByEmail(email: string): Promise<DataResponse<UserProfileDTO | null>> {
        let dataRes: DataResponse<UserProfileDTO | null> =
        {
            message: "",
            code: rc.ERROR,
            data: null
        };
        try {
            const user = await this.findByEmail(email);
            if (!user)
            {
                dataRes.message = "User not found!",
                dataRes.code =  rc.USER_NOT_FOUND
            }
            else
            {
                let userProfile: UserProfileDTO = {
                    id: user._id?.toString(),
                    name: user.fullName,
                    email: user.email,
                    dateOfBirth: user.dob,
                    phoneNumber: user.phoneNumber,
                    createdAt: user.createdAt,
                    updatedAt: user.updatedAt,
                    status: user.status,
                    address: user.address,
                    avatarUrl: user.avatarUrl,
                    medicalRecord: null
                };
                dataRes.message = "User received successfully",
                dataRes.code = rc.SUCCESS, 
                dataRes.data = userProfile;
            }
        } catch (error) {
            console.log("Server error:" + error);
            dataRes.code = rc.SERVER_ERROR;
            dataRes.message = error;
            dataRes.data = null;
        }
        return dataRes;
    }
}