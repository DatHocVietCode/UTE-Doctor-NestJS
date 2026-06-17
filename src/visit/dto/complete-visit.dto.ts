import { Type } from 'class-transformer';
import {
  IsArray,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class PrescriptionItemDto {
  @IsOptional()
  @IsMongoId()
  medicineId?: string;

  @IsNotEmpty()
  @IsString()
  name!: string;

  @IsNotEmpty()
  @IsNumber()
  quantity!: number;

  @IsString()
  @IsOptional()
  note?: string;
}

export class CompleteVisitDto {
  @IsOptional()
  @IsMongoId()
  visitId?: string;

  @IsNotEmpty()
  @IsString()
  diagnosis!: string;

  @IsString()
  @IsOptional()
  note?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PrescriptionItemDto)
  prescriptions!: PrescriptionItemDto[];
}
