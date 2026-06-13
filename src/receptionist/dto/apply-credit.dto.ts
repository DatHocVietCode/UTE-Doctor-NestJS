import { IsNumber, Min } from 'class-validator';

export class ApplyCreditDto {
  @IsNumber()
  @Min(0)
  creditToUse: number;
}
