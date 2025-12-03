import { IsEmail, IsNotEmpty, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class ProfileDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsEmail()
  email: string;

  @IsOptional()
  @IsString()
  gender?: string;

  @IsOptional()
  @IsString()
  dob?: string;

  @IsOptional()
  @IsString()
  avatarUrl?: string;
}

export class CreateDoctorDto {
  @IsString()
  @IsNotEmpty()
  doctorName: string;

  @IsOptional()
  @IsString()
  specialty?: string;

  @IsOptional()
  @IsString()
  bio?: string;

  @IsOptional()
  @IsString()
  degree?: string;

  @IsOptional()
  @IsString()
  academic?: string;

  @IsOptional()
  @IsString()
  achievements?: string;

  @IsOptional()
  @IsNumber()
  yearsOfExperience?: number;

  @ValidateNested()
  @Type(() => ProfileDto)
  profile: ProfileDto;
}
