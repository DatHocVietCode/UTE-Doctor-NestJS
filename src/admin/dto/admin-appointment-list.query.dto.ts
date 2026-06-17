import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { AppointmentStatus } from 'src/appointment/enums/Appointment-status.enum';
import { AssignmentStatus } from 'src/appointment/enums/assignment-status.enum';
import { DepositStatus } from 'src/appointment/enums/deposit-status.enum';
import { PaymentCategory } from 'src/appointment/enums/payment-category.enum';

// Read-only admin appointment list filters. All fields optional; values are
// validated and clamped so a malformed query can never crash the endpoint.
export class AdminAppointmentListQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  // e.g. "bookingDate:desc" | "scheduledAt:asc" | "updatedAt:desc"
  @IsOptional()
  @IsString()
  sort?: string;

  @IsOptional()
  @IsEnum(AppointmentStatus)
  status?: AppointmentStatus;

  @IsOptional()
  @IsEnum(PaymentCategory)
  paymentCategory?: PaymentCategory;

  @IsOptional()
  @IsEnum(AssignmentStatus)
  assignmentStatus?: AssignmentStatus;

  @IsOptional()
  @IsEnum(DepositStatus)
  depositStatus?: DepositStatus;

  @IsOptional()
  @IsString()
  doctorId?: string;

  @IsOptional()
  @IsString()
  patientEmail?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  dateFrom?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  dateTo?: number;
}
