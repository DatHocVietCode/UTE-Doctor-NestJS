import { IsEnum, IsNumber, IsOptional, IsString } from 'class-validator';
import { BloodType } from 'src/common/enum/blood-type.enum';
import { MedicalRecord } from '../schema/medical-record.schema';

export class CreatePatientDto {
  @IsString()
  profileId: string; // Liên kết tới profile

  @IsOptional()
  @IsNumber()
  height?: number;

  @IsOptional()
  @IsNumber()
  weight?: number;

  @IsOptional()
  @IsEnum(BloodType)
  bloodType?: BloodType;

  @IsOptional()
  medicalRecord?: MedicalRecord;
}
