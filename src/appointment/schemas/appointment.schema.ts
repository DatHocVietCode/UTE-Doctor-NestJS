import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import mongoose, { HydratedDocument } from "mongoose";
import { PaymentMethodEnum } from "src/payment/enums/payment-method.enum";
import { AppointmentStatus } from "../enums/Appointment-status.enum";
import { ServiceType } from "../enums/service-type.enum";

export type AppointmentDocument = HydratedDocument<Appointment>;
@Schema({ timestamps: true })
export class Appointment {
    _id!: mongoose.Types.ObjectId;

    // Deprecated: Use scheduledAt instead. Retained only for backward compatibility.
    @Prop()
    date!: number;

    // Source of truth for the scheduled appointment time in UTC epoch milliseconds.
    // This is the appointment date (khi khám).
    @Prop({ required: true })
    scheduledAt!: number;

    // Booking creation time in UTC epoch milliseconds. This is when the appointment was booked (khi đặt).
    @Prop({ required: true })
    bookingDate!: number;

    // Snapshot of the slot start time at booking/reschedule time.
    @Prop()
    startTime?: number;

    // Snapshot of the slot end time at booking/reschedule time.
    @Prop()
    endTime?: number;

    @Prop({ enum: AppointmentStatus, default: AppointmentStatus.PENDING })
    appointmentStatus!: AppointmentStatus;

    @Prop({ enum: ServiceType })
    serviceType!: ServiceType;

    @Prop()
    consultationFee!: number;

    @Prop()
    paymentAmount!: number;

    @Prop()
    paidAt!: Date;

    @Prop()
    paymentResponseCode!: string;

    @Prop()
    paymentTransactionStatus!: string;

    @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'TimeSlotLog', required: true })
    timeSlot!: mongoose.Types.ObjectId;

    @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true })
    patientId!: mongoose.Types.ObjectId; // This is account Id, not patient Id (To be fixed later)

    @Prop()
    patientEmail!: string;

    @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Doctor' })
    doctorId!: mongoose.Types.ObjectId;

    @Prop()
    reasonForAppointment!: string;

    @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'ChuyenKhoa' })
    specialtyId!: string;

    @Prop({ type: String, enum: PaymentMethodEnum })
    paymentMethod!: PaymentMethodEnum;

    @Prop()
    hospitalName!: string;
}

export const AppointmentSchema = SchemaFactory.createForClass(Appointment);
AppointmentSchema.index({ scheduledAt: 1 });
AppointmentSchema.index({ doctorId: 1, scheduledAt: 1 });
AppointmentSchema.index({ patientId: 1, scheduledAt: 1 });
AppointmentSchema.index(
    { doctorId: 1, date: 1, timeSlot: 1 },
    {
        unique: true,
        partialFilterExpression: {
            appointmentStatus: { $in: [AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED] },
        },
    },
);