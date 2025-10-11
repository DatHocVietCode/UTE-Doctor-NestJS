import { IsString, IsOptional, IsEnum, Matches } from 'class-validator';

export class GetShiftsByMonthDto {
  @IsString()
  @Matches(/^(0?[1-9]|1[0-2])$/, { message: 'Tháng phải từ 1-12' })
  month: string;

  @IsString()
  @Matches(/^\d{4}$/, { message: 'Năm phải có 4 chữ số' })
  year: string;

  @IsOptional()
  @IsEnum(['available', 'completed', 'hasClient'])
  status?: string;
}