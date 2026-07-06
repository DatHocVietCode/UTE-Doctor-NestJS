import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class AskAvailabilityDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  question!: string;
}
