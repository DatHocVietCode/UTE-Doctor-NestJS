import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';

import { Model } from 'mongoose';
import { AuthService } from 'src/auth/auth.service';
import { DataResponse } from 'src/common/dto/data-respone';
import { AccountStatusEnum } from 'src/common/enum/account-status.enum';
import { ResponseCode as rc } from 'src/common/enum/reponse-code.enum';
import { OtpDTO } from 'src/utils/otp/otp-dto';
import { Account, AccountDocument } from './schemas/account.schema';
import { RegisterUserReqDto } from 'src/auth/dto/auth-user.dto';
import { OnEvent } from '@nestjs/event-emitter';
@Injectable()
export class AccountService {
    constructor(@InjectModel(Account.name) private accountModel: Model<AccountDocument>) {}

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

    @OnEvent('account.find.by.email')
    async findByEmail(payload: { email: string }): Promise<Account | null> {
        const { email } = payload;
        console.log("Finding Account by email:", email);
        return this.accountModel.findOne({ email }).lean().exec();
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

    async remove(id: string): Promise<Account | null> {
        return this.accountModel.findByIdAndDelete(id).exec();
    }

    /**
     * 
     * @param email input Account's email
     * @returns DataResponse<OtpDTO>, include otp, created and expired time.
     */
    
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
