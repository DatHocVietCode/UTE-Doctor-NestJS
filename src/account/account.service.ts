import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';
import * as jwt from "jsonwebtoken";
import { Model } from 'mongoose';
import { AuthService } from 'src/auth/auth.service';
import { DataResponse } from 'src/common/dto/data-respone';
import { AccountStatusEnum } from 'src/common/enum/account-status.enum';
import { ResponseCode as rc } from 'src/common/enum/reponse-code.enum';
import { OtpDTO } from 'src/utils/otp/otp-dto';
import { Account, AccountDocument } from './schemas/account.schema';
import { PatientService } from 'src/patient/patient.service';
import { RegisterUserReqDto } from 'src/auth/dto/auth-user.dto';
import { OnEvent } from '@nestjs/event-emitter';
@Injectable()
export class AccountService {
    constructor(@InjectModel(Account.name) private accountModel: Model<AccountDocument>
                ,@Inject(forwardRef(() => AuthService)) private readonly authService: AuthService
            ) {}

    @OnEvent('account.createAccount')
    async createAccount(registerUser: RegisterUserReqDto
    ): Promise<DataResponse<Account>> {
        let dataRes: DataResponse =
        {
            code: rc.PENDING,
            message: "",
            data: null
        }
        // Kiểm tra email đã tồn tại chưa
        const existing = await this.accountModel.findOne({ email: registerUser.email });
        if (existing) {
            dataRes.code = rc.ERROR;
            dataRes.message = "Email existed when creating account!"
            dataRes.data = null
            return dataRes;
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(registerUser.password, 10);

        // Tạo document mới
        const newAccount = new this.accountModel({
            email: registerUser.email,
            password: hashedPassword,
        });
        newAccount.save();
        dataRes.code = rc.SUCCESS,
        dataRes.message = "Account created successfully!"
        dataRes.data = newAccount;
        return dataRes;
    }

    @OnEvent('account.linkProfile')
    async handleLinkProfile(
        payload: { accountId: string; profileId: string },
    ): Promise<DataResponse> {
        try {
        const { accountId, profileId } = payload;
        const updatedAccount = await this.accountModel.findByIdAndUpdate(
            accountId,
            { profileId },
            { new: true },
        );

        if (!updatedAccount) {
            return {
            code: rc.ERROR,
            message: 'Account not found',
            data: null,
            };
        }

        console.log(
            `[AccountService]: Linked profile ${profileId} to account ${accountId}`,
        );

        return {
            code: rc.SUCCESS,
            message: 'Linked profile successfully',
            data: updatedAccount,
        };
        } catch (error) {
        console.error('[AccountService]: Error linking profile', error);
        return {
            code: rc.ERROR,
            message: 'Failed to link profile',
            data: null,
        };
        }
    }

    async findAll(): Promise<Account[]> {
        return this.accountModel.find().exec();
    }

    async findOne(id: string): Promise<Account | null> {
        return this.accountModel.findById(id).exec();
    }

    async findByEmail(email: string): Promise<Account | null> {
        console.log("Finding Account by email: " + email);
        return this.accountModel.findOne({ email: email }).lean().exec();
    }

    @OnEvent('account.deleteAccount')
    async deleteByEmail(email: string): Promise<Account | null> {
        // Tìm account trước
        const account = await this.accountModel.findOne({ email });
        if (!account) return null;

        // Xóa account
        await this.accountModel.deleteOne({ email });
        console.log("[AccountService]: Deleted account with email:", email);

        // Trả về account đã xóa (nếu cần)
        return account;
    }

    async update(id: string, updateAccountDto: Partial<Account>): Promise<Account | null> {
        if (updateAccountDto.password) {
            updateAccountDto.password = await bcrypt.hash(updateAccountDto.password, 10);
        }
        return this.accountModel
            .findByIdAndUpdate(id, updateAccountDto, { new: true })
            .exec();
    }

    async activateAccount(email: string): Promise<DataResponse<null>> {
        let dataRes: DataResponse<null> = {
            code: rc.ERROR,
            message: "Account not found",
            data: null
        };

        
        try {
            const Account = await this.accountModel.findOne({ email }).exec();
            if (!Account) {
            dataRes.message = "Account not found!";
            dataRes.code = rc.ACCOUNT_NOT_FOUND;
            return dataRes;
            }

            Account.status = AccountStatusEnum.ACTIVE; // kích hoạt tài khoản
            await Account.save();

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

    async remove(id: string): Promise<Account | null> {
        return this.accountModel.findByIdAndDelete(id).exec();
    }

    async getAccountRefreshToken(email: string) : Promise<DataResponse<string>>
    {
        const Account = await this.accountModel.findOne({email});
        const dataRes: DataResponse= {
            message: "",
            code: rc.SERVER_ERROR,
            data: ""
        }
        if (!Account)
        {
            dataRes.code = rc.ACCOUNT_NOT_FOUND;
            dataRes.message = "Account not found";
        }
        else
        {
            if (Account.refreshToken)
            {
                if (this.isTokenAlive(Account.refreshToken))
                {
                    dataRes.code = rc.SUCCESS;
                    dataRes.message = "Successfully get refresh token";
                    dataRes.data = Account.refreshToken;
                }
            }
            else
            {
                const newRefreshToken = this.authService.createRefreshToken(email);
                Account.refreshToken = newRefreshToken;
                await Account.save();
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
     * @param email input Account's email
     * @returns DataResponse<OtpDTO>, include otp, created and expired time.
     */
    async getAccountOTPInfor(email: string) : Promise<DataResponse<OtpDTO | null>> {
        let dataRes: DataResponse<OtpDTO | null> = 
        {
            message: "",
            code: rc.ERROR,
            data: null
        };
        try {
            const Account = await this.findByEmail(email);
            if (!Account)
            {
                dataRes.message = "Account not found!",
                dataRes.code =  rc.ACCOUNT_NOT_FOUND
            }
            else
            {
                dataRes.message = "OTP received successfully",
                dataRes.code = rc.SUCCESS,
                dataRes.data = {
                    otp: Account.otp,
                    otpCreatedAt: Account.otpCreatedAt,
                    otpExpiredAt: Account.otpExpiredAt
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
    // account.service.ts
    // async getUserByEmail(email: string): Promise<DataResponse<AccountProfileDTO | null>> {
    //     let dataRes: DataResponse<AccountProfileDTO | null> =
    //     {
    //         message: "",
    //         code: rc.ERROR,
    //         data: null
    //     };
    //     try {
    //         const user = await this.findByEmail(email);
    //         if (!user)
    //         {
    //             dataRes.message = "User not found!",
    //             dataRes.code =  rc.ACCOUNT_NOT_FOUND
    //         }
    //         else
    //         {
    //             let userProfile: AccountProfileDTO = {
    //                 id: user._id?.toString(),
    //                 name: user.fullName,
    //                 email: user.email,
    //                 dateOfBirth: user.dob,
    //                 phoneNumber: user.phoneNumber,
    //                 createdAt: user.createdAt,
    //                 updatedAt: user.updatedAt,
    //                 status: user.status,
    //                 address: user.address,
    //                 avatarUrl: user.avatarUrl,
                    
    //             };
    //             dataRes.message = "User received successfully",
    //             dataRes.code = rc.SUCCESS,
    //             dataRes.data = userProfile;
    //         }
    //     } catch (error) {
    //         console.log("Server error:" + error);
    //         dataRes.code = rc.SERVER_ERROR;
    //         dataRes.message = error;
    //         dataRes.data = null;
    //     }
    //     return dataRes;
    // }
}
