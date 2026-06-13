import { Type } from "class-transformer";
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested
} from "class-validator";
import { PaymentCategory } from "src/appointment/enums/payment-category.enum";
import { ServiceType } from "src/appointment/enums/service-type.enum";
import { VisitType } from "src/appointment/enums/visit-type.enum";
import { IsIsoWithTimezone } from "src/common/validators/is-iso-with-timezone.validator";
import { PaymentMethodEnum } from "src/payment/enums/payment-method.enum";
import { CompleteVisitDto } from "src/visit/dto/complete-visit.dto";


export class AppointmentBookingRequestDto {
  // Optional at the pipe level so broad bookings (no doctor/slot) can omit it.
  // Normal booking still requires it via AppointmentBookingService.validateBookingRequest.
  @IsOptional()
  @IsString()
  hospitalName?: string;

  // When the medical visit is scheduled to happen (ISO 8601 with timezone).
  // Required for normal booking (enforced in the service); broad booking has no date yet.
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'appointmentDate is required' })
  @IsIsoWithTimezone({ message: 'appointmentDate must be ISO 8601 with timezone (Z or +/-HH:mm)' })
  appointmentDate: string;

  // Broad booking: patient books without choosing a doctor/slot; a receptionist
  // assignment task is created instead. Branches before normal validation.
  @IsOptional()
  @IsBoolean()
  broadBooking?: boolean;

  // OPTIONAL: When the booking request is created/recorded (ISO 8601 with timezone).
  // If omitted, server uses current request processing time.
  @IsOptional()
  @IsString()
  @IsIsoWithTimezone({ message: 'bookingDate must be ISO 8601 with timezone (Z or +/-HH:mm)' })
  bookingDate?: string;

  // Deprecated: Use appointmentDate instead. Retained only for backward compatibility.
  @IsOptional()
  @IsString()
  @IsIsoWithTimezone({ message: 'date must be ISO 8601 with timezone (Z or +/-HH:mm)' })
  date?: string;

  @IsOptional()
  @IsString()
  specialty?: string;

  // Optional at the pipe level for broad booking; required for normal booking (service-enforced).
  @IsOptional()
  @IsMongoId()
  timeSlotId: string;

  @ValidateNested()
  @Type(() => DoctorDto)
  @IsOptional()
  doctor: DoctorDto | null;

  @IsOptional()
  @IsEnum(ServiceType)
  serviceType: ServiceType;

  @IsOptional()
  @IsEnum(PaymentMethodEnum)
  paymentMethod: PaymentMethodEnum;

  @IsOptional()
  @IsEnum(VisitType)
  visitType?: VisitType;

  @IsOptional()
  @IsEnum(PaymentCategory)
  paymentCategory?: PaymentCategory;

  @IsOptional()
  @IsNumber()
  @Min(0)
  depositAmount?: number;

  @IsOptional()
  @IsNumber()
  amount?: number; // Deprecated: ignored by the current deposit/billing-based booking flow.

  @IsString()
  @IsOptional()
  reasonForAppointment: string;

  @IsOptional()
  @IsNumber()
  coinsToUse?: number; // Optional discount amount requested by user, capped by policy.

  @IsOptional()
  @IsBoolean()
  useCoin?: boolean; // Whether to apply coin discount on this appointment.
}

export class AppointmentBookingDto extends AppointmentBookingRequestDto {
  @IsEmail()
  patientEmail: string;

  @IsMongoId()
  patientId: string;
}

export class DoctorDto {
  @IsString()
  id: string;

  @IsString()
  name: string;

  @IsEmail()
  email: string;
}

export class CompleteAppointmentDto extends CompleteVisitDto {
  @IsNotEmpty()
  @IsMongoId()
  appointmentId: string;
}
