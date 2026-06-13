import { IsMongoId, IsNotEmpty, IsString } from 'class-validator';
import { IsIsoWithTimezone } from 'src/common/validators/is-iso-with-timezone.validator';

// Body for POST /appointment/assignment-tasks/:id/assign.
// taskId comes from the :id URL param, the acting receptionist from the JWT.
export class AssignmentTaskAssignDto {
  @IsNotEmpty()
  @IsMongoId()
  doctorId!: string;

  @IsNotEmpty()
  @IsMongoId()
  timeSlotId!: string;

  @IsNotEmpty()
  @IsString()
  @IsIsoWithTimezone({ message: 'appointmentDate must be ISO 8601 with timezone (Z or +/-HH:mm)' })
  appointmentDate!: string;
}
