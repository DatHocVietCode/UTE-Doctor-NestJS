import { IsOptional, IsString } from 'class-validator';

export class CreateDoctorDto {
  @IsString()
  profileId: string; // Link to profile

  @IsString()
  chuyenKhoaId: string; // liên kết tới chuyên khoa

  @IsOptional()
  @IsString()
  degree?: string;

  @IsOptional()
  yearsOfExperience?: number;
}
