import { IsMongoId, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { IsIsoWithTimezone } from 'src/common/validators/is-iso-with-timezone.validator';

// Fields accepted in the request body for PATCH /appointment/:id/reschedule.
// appointmentId is NOT part of the body — it comes from the :id URL parameter.
export class AppointmentRescheduleDto {
  // New scheduled visit date/time; must be ISO 8601 with timezone per AGENTS.md datetime rules.
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

// Internal service input: body fields augmented with route-level context injected by the controller.
export interface RescheduleInput extends AppointmentRescheduleDto {
  // Injected from :id URL parameter.
  appointmentId: string;
  // Injected from JWT user (req.user); used for audit logging.
  rescheduledBy?: string;
}
