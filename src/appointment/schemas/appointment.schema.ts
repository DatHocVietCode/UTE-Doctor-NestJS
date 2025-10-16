import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import mongoose, { HydratedDocument, mongo } from "mongoose";
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

    @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'TimeSlot', required: true })
    timeSlot: mongoose.Types.ObjectId;

    @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true })
    patientId: mongoose.Types.ObjectId;

    @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Doctor', required: true })
    doctorId: mongoose.Types.ObjectId;
}

export const AppointmentSchema = SchemaFactory.createForClass(Appointment);