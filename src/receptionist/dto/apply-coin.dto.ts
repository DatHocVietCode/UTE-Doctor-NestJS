import { IsNumber, Min } from 'class-validator';

export class ApplyCoinDto {
  @IsNumber()
  @Min(0)
  coinToUse: number;
}
