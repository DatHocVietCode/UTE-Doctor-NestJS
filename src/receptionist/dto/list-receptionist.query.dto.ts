import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

// Admin receptionist-list query. All fields optional; values are validated and clamped so a
// malformed query can never crash the endpoint (mirrors AdminAppointmentListQueryDto).
export class ListReceptionistQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  // Case-insensitive substring match on full name or email.
  @IsOptional()
  @IsString()
  search?: string;
}
