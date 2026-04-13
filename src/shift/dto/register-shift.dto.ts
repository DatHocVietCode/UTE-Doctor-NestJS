import { IsIn, IsNotEmpty, IsOptional, IsString, ValidateIf } from 'class-validator';
import { IsIsoWithTimezone } from 'src/common/validators/is-iso-with-timezone.validator';

export class RegisterShiftRequestDto {
  @ValidateIf((o) => !o.legacyAllowMissingTimezone)
  @IsIsoWithTimezone({ message: 'startTime must be ISO 8601 with timezone (Z or +/-HH:mm)' })
  @IsNotEmpty()
  startTime: string;

  @ValidateIf((o) => !o.legacyAllowMissingTimezone)
  @IsIsoWithTimezone({ message: 'endTime must be ISO 8601 with timezone (Z or +/-HH:mm)' })
  @IsNotEmpty()
  endTime: string;

  @IsOptional()
  legacyAllowMissingTimezone?: boolean;

  @IsString()
  @IsIn(['morning', 'afternoon', 'extra'])
  shift: 'morning' | 'afternoon' | 'extra';
}

export class RegisterShiftDto extends RegisterShiftRequestDto {
  @IsString()
  @IsNotEmpty()
  doctorId: string;

  @IsOptional()
  startTimeUtc?: string;

  @IsOptional()
  endTimeUtc?: string;

  @IsOptional()
  startTimeEpoch?: number;

  @IsOptional()
  endTimeEpoch?: number;

  @IsOptional()
  dateKey?: string;
}