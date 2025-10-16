import { Body, Controller, Get, Param, Patch, Put } from '@nestjs/common';
import { ProfileService } from './profile.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { DataResponse } from 'src/common/dto/data-respone';
import { ResponseCode as rc } from 'src/common/enum/reponse-code.enum';
import { Profile } from './schema/profile.schema';

@Controller('profiles')
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  // Lấy thông tin profile theo accountId
  @Get(':id')
  async getProfile(@Param('id') id: string) {
    const profile = await this.profileService.findById(id);
    return {
      code: rc.SUCCESS,
      message: 'Get profile successfully!',
      data: profile,
    } as DataResponse<Profile>;
  }

  // Chỉnh sửa profile
  @Patch(':accountId')
  async updateProfile(
    @Param('accountId') accountId: string,
    @Body() updateProfileDto: UpdateProfileDto,
  ) {
    const updated = await this.profileService.update(accountId, updateProfileDto);
    return {
        code: rc.SUCCESS,
        message: 'Update profile successfully!',
        data: updated,
    } as DataResponse<Profile>;

  }
}
