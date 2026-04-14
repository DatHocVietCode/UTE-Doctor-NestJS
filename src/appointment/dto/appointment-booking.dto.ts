import { Type } from "class-transformer";
import {
  IsArray,
  IsEmail,
  IsEnum,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested
} from "class-validator";
import { ServiceType } from "src/appointment/enums/service-type.enum";
import { IsIsoWithTimezone } from "src/common/validators/is-iso-with-timezone.validator";
import { PaymentMethodEnum } from "src/payment/enums/payment-method.enum";


export class AppointmentBookingRequestDto {
  @IsString()
  hospitalName: string;

  // REQUIRED: When the medical visit is scheduled to happen (ISO 8601 with timezone).
  @IsString()
  @IsNotEmpty({ message: 'appointmentDate is required' })
  @IsIsoWithTimezone({ message: 'appointmentDate must be ISO 8601 with timezone (Z or +/-HH:mm)' })
  appointmentDate: string;

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

  @IsMongoId()
  timeSlotId: string;

  @ValidateNested()
  @Type(() => DoctorDto)
  @IsOptional()
  doctor: DoctorDto | null;

  @IsEnum(ServiceType)
  serviceType: ServiceType;

  @IsEnum(PaymentMethodEnum)
  paymentMethod: PaymentMethodEnum;

  @IsOptional()
  @IsNumber()
  amount?: number;

  @IsString()
  @IsOptional()
  reasonForAppointment: string;

  @IsOptional()
  @IsNumber()
  coinsToUse?: number; // Optional discount amount requested by user, capped by policy.

  @IsOptional()
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

export class PrescriptionItemDto {
  @IsOptional()
  @IsMongoId()
  medicineId?: string;

  @IsNotEmpty()
  @IsString()
  name: string;

  @IsNotEmpty()
  @IsNumber()
  quantity: number;

  @IsNotEmpty()
  @IsString()
  note: string;
}

export class CompleteAppointmentDto {
  @IsNotEmpty()
  @IsMongoId()
  appointmentId: string;

  @IsNotEmpty()
  @IsString()
  diagnosis: string;

  @IsString()
  @IsOptional()
  note?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PrescriptionItemDto)
  prescriptions: PrescriptionItemDto[];
}
