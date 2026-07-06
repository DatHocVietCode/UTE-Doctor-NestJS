import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class AskAppointmentBookingGuideDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  question!: string;
}
