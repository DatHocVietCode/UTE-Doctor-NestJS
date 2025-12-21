import { IsMongoId, IsOptional, IsString } from 'class-validator';

export class CreateDoctorPostDto {
  @IsMongoId()
  doctorId: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;
}
