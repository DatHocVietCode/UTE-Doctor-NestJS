import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import mongoose, { HydratedDocument } from "mongoose";
import { PaymentMethodEnum } from "src/payment/enums/payment-method.enum";
import { AppointmentStatus } from "../enums/Appointment-status.enum";
import { ServiceType } from "../enums/service-type.enum";

export type AppointmentDocument = HydratedDocument<Appointment>;
@Schema({ timestamps: true })
export class Appointment {
    _id: mongoose.Types.ObjectId;

    @Prop()
    date: Date;

    @Prop({ enum: AppointmentStatus, default: AppointmentStatus.PENDING })
    appointmentStatus: AppointmentStatus;

    @Prop({ enum: ServiceType })
    serviceType: ServiceType;

    @Prop()
    consultationFee: number;

    @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'TimeSlotLog', required: true })
    timeSlot: mongoose.Types.ObjectId;

    @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true })
    patientId: mongoose.Types.ObjectId;

    @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Doctor' })
    doctorId: mongoose.Types.ObjectId;

    @Prop()
    reasonForAppointment: string;

    @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'ChuyenKhoa' })
    specialtyId: string;

    @Prop({ type: String, enum: PaymentMethodEnum })
    paymentMethod:PaymentMethodEnum;

    @Prop()
    hospitalName: string;
}

export const AppointmentSchema = SchemaFactory.createForClass(Appointment);