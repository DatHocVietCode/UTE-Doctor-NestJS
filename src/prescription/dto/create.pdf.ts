
import { IsString, IsArray, IsDate, IsOptional, IsNumber, ValidateNested, IsMongoId } from 'class-validator';
import { Type } from 'class-transformer';

export class PrescriptionItemDto {
  @IsOptional()
  @IsMongoId()
  medicineId?: string;

  @IsString()
  name: string;

  @IsNumber()
  quantity: number;

  @IsOptional()
  @IsString()
  note?: string;
}

export class CreatePrescriptionPdfDto {
  @IsString()
  diagnosis: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PrescriptionItemDto)
  prescriptions: PrescriptionItemDto[];

  @IsOptional()
  @IsString()
  note?: string;

  @IsDate()
  @Type(() => Date)
  dateRecord: Date;

  @IsOptional()
  @IsString()
  patientName?: string;

  @IsOptional()
  @IsNumber()
  patientAge?: number;

  @IsOptional()
  @IsString()
  doctorName?: string;
}