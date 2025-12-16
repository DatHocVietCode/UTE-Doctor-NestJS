import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';

import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import mongoose, { Model } from 'mongoose';
import { RegisterUserReqDto } from 'src/auth/dto/auth-user.dto';
import { CloudinaryService } from 'src/cloudinary/cloudinary.service';
import { DataResponse } from 'src/common/dto/data-respone';
import { ResponseCode as rc } from 'src/common/enum/reponse-code.enum';
import { Account, AccountDocument } from './schemas/account.schema';
import { AccountStatusEnum } from 'src/common/enum/account-status.enum';
@Injectable()
export class AccountService {
    constructor(
        @InjectModel(Account.name) private accountModel: Model<AccountDocument>,
        private readonly eventEmitter: EventEmitter2,
        private readonly cloudinaryService: CloudinaryService,
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

    async updateUserProfile(accountId: string, updateProfileDto: any): Promise<DataResponse> {
        const dataRes: DataResponse = {
            code: rc.PENDING,
            message: '',
            data: null,
        };
           
        console.log('[AccountService]: Updating profile for accountId:', accountId, 'with data:', updateProfileDto);

        try {
            const account = await this.accountModel.findById(accountId).populate('profileId');

            if (!account) {
                dataRes.code = rc.ERROR;
                dataRes.message = 'Account not found';
                return dataRes;
            }

        if (account.profileId) {
            const profileUpdateData: any = {};

            if (updateProfileDto.name !== undefined) profileUpdateData.name = updateProfileDto.name;
            if (updateProfileDto.phoneNumber !== undefined) profileUpdateData.phone = updateProfileDto.phoneNumber;
            if (updateProfileDto.dateOfBirth !== undefined) {
                const dobVal = updateProfileDto.dateOfBirth;
                profileUpdateData.dob = typeof dobVal === 'string' ? new Date(dobVal) : dobVal;
            }
            if (updateProfileDto.address !== undefined) profileUpdateData.address = updateProfileDto.address;
            if (updateProfileDto.gender !== undefined) profileUpdateData.gender = updateProfileDto.gender;
            if (updateProfileDto.avatarUrl !== undefined) {
                // If the avatar is a base64 data URI, upload it to Cloudinary
                try {
                    const avatarValue = updateProfileDto.avatarUrl as string;
                    if (avatarValue && typeof avatarValue === 'string' && avatarValue.startsWith('data:')) {
                        // Upload base64 to cloudinary
                        const uploadedUrl = await this.cloudinaryService.uploadBase64(avatarValue, 'profiles');
                        profileUpdateData.avatarUrl = uploadedUrl;
                    } else {
                        // Assume it's an already-hosted URL, or empty -> keep as is
                        profileUpdateData.avatarUrl = avatarValue;
                    }
                } catch (error) {
                    console.error('[AccountService]: Failed to upload avatar to Cloudinary', error);
                    // Fallback: if upload fails, keep original base64 or URL
                    profileUpdateData.avatarUrl = updateProfileDto.avatarUrl;
                }
            }

            // Chuẩn hóa profileId
            const profileId = account.profileId instanceof mongoose.Types.ObjectId
                ? account.profileId.toString()                  // nếu là ObjectId
                : (account.profileId as any)._id?.toString() || '';   // nếu là document populate

            console.log('[AccountService]: Emitting profile.update event for profileId:', profileId, 'with data:', profileUpdateData);
            
            this.eventEmitter.emit('profile.update', {
                profileId,
                data: profileUpdateData
            });
        }

            const updatedAccount = await this.accountModel.findById(accountId).populate('profileId');

            dataRes.code = rc.SUCCESS;
            dataRes.message = 'Profile updated successfully';
            dataRes.data = updatedAccount;

            return dataRes;
        } catch (error) {
            console.error('[AccountService]: Error updating profile', error);
            dataRes.code = rc.ERROR;
            dataRes.message = 'Failed to update profile';
            dataRes.data = null;
            return dataRes;
        }
    }

    async changePassword(accountId: string, currentPassword: string, newPassword: string): Promise<DataResponse> {
        const dataRes: DataResponse = {
            code: rc.PENDING,
            message: '',
            data: null,
        };

        try {
            const account = await this.accountModel.findById(accountId).exec();
            if (!account) {
                dataRes.code = rc.ERROR;
                dataRes.message = 'Account not found';
                return dataRes;
            }

            // Compare current password
            const match = await bcrypt.compare(currentPassword, account.password || '');
            if (!match) {
                dataRes.code = rc.ERROR;
                dataRes.message = 'Current password is incorrect';
                return dataRes;
            }

            // Hash new password and update
            const hashed = await bcrypt.hash(newPassword, 10);
            account.password = hashed;
            await account.save();

            dataRes.code = rc.SUCCESS;
            dataRes.message = 'Password changed successfully';
            dataRes.data = null;
            return dataRes;
        } catch (error) {
            console.error('[AccountService]: Error changing password', error);
            dataRes.code = rc.ERROR;
            dataRes.message = 'Failed to change password';
            dataRes.data = null;
            return dataRes;
        }
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

    async updateStatus(accountId: string, status: AccountStatusEnum) {
        const account = await this.accountModel.findById(accountId);

        if (!account) {
            return {
            code: 404,
            message: "Account not found",
            data: null
            };
        }

        account.status = status;
        await account.save();

        return {
            code: 200,
            message: "Status updated successfully",
            data: account
        };
    }

}
