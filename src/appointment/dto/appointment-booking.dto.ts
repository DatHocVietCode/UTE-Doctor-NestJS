import { Type } from "class-transformer";
import {
    IsDecimal,
    IsEmail,
    IsEnum,
    IsMongoId,
    IsNumber,
    IsOptional,
    IsString,
    ValidateNested,
} from "class-validator";
import { ServiceType } from "src/appointment/enums/service-type.enum";
import { PaymentMethod } from "src/common/enum/paymentMethod.enum";


export class AppointmentBookingDto {
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

  @IsEnum(PaymentMethod)
  paymentMethod: PaymentMethod;

  @IsOptional()
  @IsNumber()
  amount?: number;

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
