import { Injectable } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import * as appointmentEnriched from "src/appointment/schemas/appointment-enriched";
import type { NotificationPayload } from "../dto/notification-payload.dto";
import { NotificationJobPublisher } from "../notification-job.publisher";


@Injectable()
export class AppointmentNotificationListener
{
    constructor(private readonly notificationPublisher: NotificationJobPublisher) {}

    private async publish(payload: NotificationPayload): Promise<void> {
        await this.notificationPublisher.publish(payload);
    }

    @OnEvent('notify.patient.booking.success')
    async handlePatientNotification(payload: appointmentEnriched.AppointmentEnriched) {
        const recipientEmail = payload.patientEmail.trim().toLowerCase();
        await this.publish({
            type: 'APPOINTMENT_SUCCESS',
            data: payload,
            createdAt: Date.now(),
            recipientEmail,
            idempotencyKey: `APPOINTMENT_SUCCESS:${payload._id?.toString?.() || payload._id}:${recipientEmail}`,
        });
    }

    @OnEvent('notify.doctor.booking.success')
    async handleDoctorNotification(payload: appointmentEnriched.AppointmentEnriched) {
        if (!payload.doctorEmail) {
            return;
        }

        const recipientEmail = payload.doctorEmail.trim().toLowerCase();

        await this.publish({
            type: 'APPOINTMENT_SUCCESS',
            data: payload,
            createdAt: Date.now(),
            recipientEmail,
            idempotencyKey: `APPOINTMENT_SUCCESS:${payload._id?.toString?.() || payload._id}:${recipientEmail}`,
        });
    }

    @OnEvent('notify.patient.shift.cancelled')
    async handlePatientShiftCancelled(payload: {
        patientEmail: string;
        doctorName?: string;
        date: string;
        timeSlot: string;
        hospitalName?: string;
        reason?: string;
    }) {
        const recipientEmail = payload.patientEmail.trim().toLowerCase();
        await this.publish({
            type: 'APPOINTMENT_CANCELLED',
            data: {
                appointmentId: 'shift-cancelled',
                patientEmail: payload.patientEmail,
                date: payload.date,
                timeSlot: payload.timeSlot,
                hospitalName: payload.hospitalName,
                reason: payload.reason,
            },
            createdAt: Date.now(),
            recipientEmail,
            idempotencyKey: `APPOINTMENT_CANCELLED:shift:${recipientEmail}:${payload.date}:${payload.timeSlot}`,
        });
    }

    @OnEvent('notify.doctor.shift.cancelled')
    async handleDoctorShiftCancelled(payload: {
        doctorEmail: string;
        date: string;
        shift: string;
        reason?: string;
        affectedAppointmentsCount: number;
    }) {
        const recipientEmail = payload.doctorEmail.trim().toLowerCase();
        await this.publish({
            type: 'APPOINTMENT_CANCELLED',
            data: {
                appointmentId: `doctor-shift-${payload.date}-${payload.shift}`,
                patientEmail: payload.doctorEmail,
                doctorEmail: payload.doctorEmail,
                date: payload.date,
                timeSlot: payload.shift,
                reason: payload.reason,
            },
            createdAt: Date.now(),
            recipientEmail,
            idempotencyKey: `APPOINTMENT_CANCELLED:doctor-shift:${recipientEmail}:${payload.date}:${payload.shift}`,
        });
    }

    @OnEvent('notify.patient.appointment.cancelled')
    async handlePatientAppointmentCancelled(payload: {
        appointmentId?: string;
        patientEmail: string;
        doctorEmail?: string;
        doctorName?: string;
        date: string;
        timeSlot: string;
        timeSlotLabel?: string;
        hospitalName?: string;
        reason?: string;
        refundAmount?: number;
        shouldRefund?: boolean;
    }) {
        const patientRecipient = payload.patientEmail.trim().toLowerCase();
        await this.publish({
            type: 'APPOINTMENT_CANCELLED',
            data: {
                appointmentId: payload.appointmentId || 'appointment-cancelled',
                patientEmail: payload.patientEmail,
                doctorEmail: payload.doctorEmail,
                date: payload.date,
                timeSlot: payload.timeSlot,
                timeSlotLabel: payload.timeSlotLabel,
                hospitalName: payload.hospitalName,
                reason: payload.reason,
                refundAmount: payload.refundAmount,
                shouldRefund: payload.shouldRefund,
            },
            createdAt: Date.now(),
            recipientEmail: patientRecipient,
            idempotencyKey: `APPOINTMENT_CANCELLED:${payload.appointmentId || 'na'}:${patientRecipient}`,
        });

        if (payload.doctorEmail) {
            const doctorRecipient = payload.doctorEmail.trim().toLowerCase();
            await this.publish({
                type: 'APPOINTMENT_CANCELLED',
                data: {
                    appointmentId: payload.appointmentId || 'appointment-cancelled',
                    patientEmail: payload.patientEmail,
                    doctorEmail: payload.doctorEmail,
                    date: payload.date,
                    timeSlot: payload.timeSlot,
                    timeSlotLabel: payload.timeSlotLabel,
                    hospitalName: payload.hospitalName,
                    reason: payload.reason,
                    refundAmount: payload.refundAmount,
                    shouldRefund: payload.shouldRefund,
                },
                createdAt: Date.now(),
                recipientEmail: doctorRecipient,
                idempotencyKey: `APPOINTMENT_CANCELLED:${payload.appointmentId || 'na'}:${doctorRecipient}`,
            });
        }
    }
}