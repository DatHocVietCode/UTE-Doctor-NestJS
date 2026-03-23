import { IsMongoId, IsOptional, IsString } from 'class-validator';

export class CreateDoctorPostRequestDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class CreateDoctorPostDto extends CreateDoctorPostRequestDto {
  @IsMongoId()
  doctorId: string;
}