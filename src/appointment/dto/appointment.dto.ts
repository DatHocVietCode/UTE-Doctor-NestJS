import { PaymentMethodEnum } from "src/payment/enums/payment-method.enum";
import { AppointmentStatus } from "../enums/Appointment-status.enum";
import { ServiceType } from "../enums/service-type.enum";

export class AppointmentDto {
    _id: string; // ObjectId dạng string

    date: number;

    appointmentStatus: AppointmentStatus;

    serviceType: ServiceType;

    consultationFee: number;

    timeSlot: string; // ObjectId dạng string

    patientId: string; // ObjectId dạng string

    patientEmail: string;

    doctorId?: string; // optional

    reasonForAppointment: string;

    specialtyId?: string;

    paymentMethod?: PaymentMethodEnum;

    hospitalName?: string;

    createdAt?: Date;

    updatedAt?: Date;
}
