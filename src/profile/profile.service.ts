import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Profile, ProfileDocument } from './schema/profile.schema';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { DataResponse } from 'src/common/dto/data-respone';
import { CreateProfileDto } from './dto/create-profile.dto';
import { OnEvent } from '@nestjs/event-emitter';
import { ResponseCode as rc } from 'src/common/enum/reponse-code.enum';

@Injectable()
export class ProfileService {
  constructor(
    @InjectModel(Profile.name) private profileModel: Model<ProfileDocument>,
  ) {}

  @OnEvent('profile.createProfile')
  async createProfile(createProfileDto: CreateProfileDto): Promise<DataResponse<Profile>> {
    const dataRes: DataResponse<Profile> = {
      code: rc.PENDING,
      message: '',
      data: null,
    };

    try {
      // check duplicate email (nếu cần)
      const exist = await this.profileModel.findOne({ email: createProfileDto.email });
      if (exist) {
        dataRes.code = rc.ERROR;
        dataRes.message = 'Profile with this email already exists!';
        return dataRes;
      }

      const newProfile = new this.profileModel(createProfileDto);
      const savedProfile = await newProfile.save();

      dataRes.code = rc.SUCCESS;
      dataRes.message = 'Profile created successfully!';
      dataRes.data = savedProfile;
      return dataRes;
    } catch (error) {
      dataRes.code = rc.ERROR;
      dataRes.message = 'Error creating profile: ' + error.message;
      return dataRes;
    }
  }

  async findByAccountId(accountId: string): Promise<Profile> {
    const profile = await this.profileModel.findOne({ accountId }).exec();
    if (!profile) throw new NotFoundException('Profile not found');
    return profile;
  }

  async update(accountId: string, dto: UpdateProfileDto): Promise<Profile> {
    const updated = await this.profileModel
      .findOneAndUpdate({ accountId }, dto, { new: true })
      .exec();
    if (!updated) throw new NotFoundException('Profile not found');
    return updated;
  }

  async findByEmail(email: string) : Promise<Profile | null> {
    const profile = await this.profileModel.findOne({email: email});
    return profile;
  }

  @OnEvent('profile.getProfile')
  async handleGetProfile(payload: { email: string }) {
    const profile = await this.findByEmail(payload.email);
    if (!profile) return null;

    console.log('[ProfileService]: Fetch profile: ', profile)

    return {
      id: profile._id.toString(),
      email: profile.email,
      name: profile.name,
      gender: profile.gender,
      phoneNumber: profile.phone,
    };
  }
}
