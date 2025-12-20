import { PartialType } from '@nestjs/mapped-types';
import { CreateDoctorPostDto } from './create-doctor-post.dto';
import { IsOptional, IsString } from 'class-validator';

export class UpdateDoctorPostDto extends PartialType(CreateDoctorPostDto) {
  @IsOptional()
  @IsString()
  status?: 'ACTIVE' | 'HIDDEN';
}
