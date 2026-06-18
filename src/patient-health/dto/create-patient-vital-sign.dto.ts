import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { BloodType } from 'src/common/enum/blood-type.enum';

// Only client-supplied fields. The global ValidationPipe (whitelist + forbidNonWhitelisted)
// rejects any server-owned field (patientId, bmi, status, source, recordState, measuredBy, ...).
// Per-field physiological bounds live here; cross-field rules (BP atomicity, "at least one
// measurement", measuredAt window) are enforced in the service.
export class CreatePatientVitalSignDto {
  @IsOptional()
  @IsNumber()
  @Min(30)
  @Max(300)
  heightCm?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(500)
  weightKg?: number;

  @IsOptional()
  @IsInt()
  @Min(50)
  @Max(300)
  bloodPressureSystolic?: number;

  @IsOptional()
  @IsInt()
  @Min(30)
  @Max(200)
  bloodPressureDiastolic?: number;

  @IsOptional()
  @IsInt()
  @Min(20)
  @Max(300)
  heartRateBpm?: number;

  // MVP: only A | B | AB | O (no Rh factor).
  @IsOptional()
  @IsEnum(BloodType)
  bloodType?: BloodType;

  // Epoch milliseconds UTC. Omitted -> server time. Bounds validated in the service.
  @IsOptional()
  @IsInt()
  @Min(1)
  measuredAt?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
