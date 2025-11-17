import { Injectable } from "@nestjs/common";
import { EventEmitter2, OnEvent } from "@nestjs/event-emitter";
import e from "express";
import { AppointmentBookingDto } from "src/appointment/dto/appointment-booking.dto";
import { buildEnrichedAppointmentPayload } from "src/appointment/schemas/appointment-enriched";
import { AppointmentDocument } from "src/appointment/schemas/appointment.schema";
import { Doctor, DoctorDocument } from "src/doctor/schema/doctor.schema";
import { Patient, PatientDocument } from "src/patient/schema/patient.schema";
import { PaymentStatusEnum } from "src/payment/enums/payment-status.enum";
import { emitTyped } from "src/utils/helpers/event.helper";

@Injectable()
export class BookingAppointmentPostSubmitSaga {
    constructor (private readonly eventEmitter: EventEmitter2) {}
    
    @OnEvent('payment.success')
    async handlePaymentSuccessEvent(payload: { orderId: string; amount: number }) {
        console.log('[Saga] Getting appointment by Id', payload.orderId);
        
        const appointment = await emitTyped<string, AppointmentDocument>(
            this.eventEmitter,
            'appointment.get.byId',
            payload.orderId
        );

        console.log('[Saga] Retrieved appointment:', appointment);

         if (!appointment) {
            console.error('[Saga] Appointment not found for orderId:', payload.orderId);
            return;
        }
        console.log('[Saga] Retrieved appointment:', appointment);

        const doctor : Doctor = await emitTyped<string, Doctor>(
            this.eventEmitter,
            'doctor.get.byId',
            appointment.doctorId.toString()
        );

        const patient : Patient = await emitTyped<string, Patient>(
            this.eventEmitter,
            'patient.get.byId',
            appointment.patientId.toString()
        );


        console.log('[Saga] Retrieved doctor and patient profiles' , doctor, patient);
        

        const doctorProfile = await emitTyped<string, any>(
            this.eventEmitter,
            'doctor.get.profile',
             doctor.profileId.toString() 
        );

        const patientProfile = await emitTyped<string, any>(
            this.eventEmitter,
            'patient.get.profile',
            patient.profileId.toString() 
        );

        const enrichedPayload = buildEnrichedAppointmentPayload(
            appointment,
            doctorProfile,
            patientProfile,
            payload.amount
        );

        enrichedPayload.paymentStatus = PaymentStatusEnum.COMPLETED;


        this.eventEmitter.emit('appointment.booking.success', enrichedPayload);
        console.log('[Saga] Emitted appointment.booking.success for appointmentId:', payload.orderId);
    }

    @OnEvent('payment.failed')
    async handlePaymentFailedEvent(payload: { orderId: string; reason: string }) {
        console.log('[Saga] Handling payment failure for orderId:', payload.orderId, 'Reason:', payload.reason);
        // Here you can add logic to update appointment status, notify user, etc.
    }
}