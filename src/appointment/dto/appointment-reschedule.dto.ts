import { IsMongoId, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { IsIsoWithTimezone } from 'src/common/validators/is-iso-with-timezone.validator';

export class AppointmentRescheduleDto {
  @IsNotEmpty()
  @IsMongoId()
  appointmentId!: string;

  // appointmentDate is the scheduled visit day/time and must include timezone.
  @IsNotEmpty()
  @IsString()
  @IsIsoWithTimezone({ message: 'appointmentDate must be ISO 8601 with timezone (Z or +/-HH:mm)' })
  appointmentDate!: string;

  @IsNotEmpty()
  @IsMongoId()
  timeSlotId!: string;

  @IsOptional()
  @IsString()
  reason?: string;
}
