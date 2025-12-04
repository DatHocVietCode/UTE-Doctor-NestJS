import { 
  IsEmail, 
  IsNotEmpty, 
  IsNumber, 
  IsOptional, 
  IsString, 
  ValidateNested, 
  IsArray 
} from 'class-validator';
import { Type } from 'class-transformer';

class UpdateProfileDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

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

export class UpdateDoctorDto {
  @IsOptional()
  @IsString()
  doctorName?: string;

  @IsOptional()
  @IsString()
  specialty?: string;

  @IsOptional()
  @IsString()
  bio?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  degree?: string[];

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
  @IsOptional()
  @Type(() => UpdateProfileDto)
  profile?: UpdateProfileDto;
}
