import { IsMongoId, IsOptional, IsString, MaxLength } from 'class-validator';

export class AppointmentCancelDto {
  @IsMongoId()
  appointmentId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
