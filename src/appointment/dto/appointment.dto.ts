import { PaymentMethodEnum } from "src/payment/enums/payment-method.enum";
import { AppointmentStatus } from "../enums/Appointment-status.enum";
import { ServiceType } from "../enums/service-type.enum";

export class AppointmentDto {
    _id: string; // ObjectId dạng string

    // Deprecated compatibility alias retained during the migration window.
    date: number;
    // UTC epoch timestamp when the appointment was booked (khi đặt).
    bookingDate: number;


    // Canonical UTC epoch for the appointment schedule.
    scheduledAt: number;

    // Persisted slot snapshot captured when the appointment was booked.
    startTime?: number;

    // Persisted slot snapshot captured when the appointment was booked.
    endTime?: number;

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
