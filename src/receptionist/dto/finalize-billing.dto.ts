import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsMongoId,
  IsNumber,
  IsOptional,
  ValidateNested,
} from 'class-validator';

export enum MedicationSourceDto {
  CLINIC = 'CLINIC',
  OUTSIDE_PURCHASE = 'OUTSIDE_PURCHASE',
}

export class MedicationFulfillmentDto {
  @IsOptional()
  @IsMongoId()
  medicineId?: string;

  @IsNumber()
  dispensedQty!: number;

  @IsEnum(MedicationSourceDto)
  source!: MedicationSourceDto;
}

export class FinalizeBillingDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MedicationFulfillmentDto)
  medications!: MedicationFulfillmentDto[];
}
