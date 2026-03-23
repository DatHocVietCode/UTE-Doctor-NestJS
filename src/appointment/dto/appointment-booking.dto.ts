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
import { PaymentMethodEnum } from "src/payment/enums/payment-method.enum";


export class AppointmentBookingRequestDto {
  @IsString()
  hospitalName: string;

  @IsString()
  date: Date;

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
  coinsToUse?: number; // Number of coins to use for payment

  @IsOptional()
  useCoin?: boolean; // Whether to use coins for this appointment
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

export class RescheduleAppointmentDto {
  @IsNotEmpty()
  @IsMongoId()
  appointmentId: string;

  @IsNotEmpty()
  @IsString()
  newDate: string; // ISO date string

  @IsNotEmpty()
  @IsMongoId()
  newTimeSlotId: string;

  @IsString()
  @IsOptional()
  reason?: string;
}
