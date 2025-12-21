import { Injectable } from "@nestjs/common";
import { EventEmitter2, OnEvent } from "@nestjs/event-emitter";
import e from "express";
import { AppointmentBookingDto } from "src/appointment/dto/appointment-booking.dto";
import { buildEnrichedAppointmentPayload } from "src/appointment/schemas/appointment-enriched";
import { AppointmentDocument } from "src/appointment/schemas/appointment.schema";
import { Doctor, DoctorDocument } from "src/doctor/schema/doctor.schema";
import { Patient, PatientDocument } from "src/patient/schema/patient.schema";
import { PaymentStatusEnum } from "src/payment/enums/payment-status.enum";
import { Profile } from "src/profile/schema/profile.schema";
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

        const patient : Patient = await emitTyped<string, PatientDocument>(
            this.eventEmitter,
            'patient.get.byEmail',
            appointment.patientEmail
        );


        console.log('[Saga] Retrieved doctor and patient profiles' , doctor, patient);
        

        const doctorProfileId = doctor?.profileId?._id?.toString() || doctor?.profileId?.toString();
        const patientProfileId = patient?.profileId?.toString();

        if (!doctorProfileId || !patientProfileId) {
            console.error('[Saga] Missing profileId', { doctor, patient });
            return;
        }

        const doctorProfile: Profile = doctor?.profileId as unknown as Profile;

        const patientProfile = patient?.profileId as unknown as Profile;

        console.log('[Saga] Retrieved doctorProfile and patientProfile' , doctorProfile, patientProfile);


        const enrichedPayload = buildEnrichedAppointmentPayload(
            appointment,
            doctorProfile,
            patientProfile,
            payload.amount,
            patientProfile.name,
            patientProfile.email
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