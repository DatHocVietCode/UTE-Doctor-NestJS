import { IsOptional, IsString } from 'class-validator';

export class TodayVisitsQueryDto {
  // Invalid or blank IANA timezone values are deliberately handled by the service fallback.
  @IsOptional()
  @IsString()
  timezone?: string;
}
