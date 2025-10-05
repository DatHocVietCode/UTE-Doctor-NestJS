import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Profile, ProfileDocument } from './schema/profile.schema';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class ProfileService {
  constructor(
    @InjectModel(Profile.name) private profileModel: Model<ProfileDocument>,
  ) {}

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
}
