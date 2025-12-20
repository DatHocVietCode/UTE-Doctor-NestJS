import { Injectable } from "@nestjs/common";
import { EventEmitter2, OnEvent } from "@nestjs/event-emitter";
import { AppointmentBookingDto } from "src/appointment/dto/appointment-booking.dto";
import { buildEnrichedAppointmentPayload } from "src/appointment/schemas/appointment-enriched";
import { AppointmentDocument } from "src/appointment/schemas/appointment.schema";
import { Doctor } from "src/doctor/schema/doctor.schema";
import { Patient, PatientDocument } from "src/patient/schema/patient.schema";
import { PaymentMethodEnum } from "src/payment/enums/payment-method.enum";
import { PaymentStatusEnum } from "src/payment/enums/payment-status.enum";
import { Profile } from "src/profile/schema/profile.schema";
import { emitTyped } from "src/utils/helpers/event.helper";

@Injectable()
export class BookingAppointmentSubmitSaga {
    constructor (private readonly eventEmitter: EventEmitter2) {}
    // Impl happy case first, then add more complex logic later
    @OnEvent('appointment.booked') // received through http post
    async handleBookingAppointment(payload: AppointmentBookingDto) {

        // Validate booking information completeness first
        if (!this.isBookingInformationEnough(payload)) {
            console.log('[Saga] Booking information insufficient. Rejecting booking:', payload);
            this.eventEmitter.emit('appointment.booking.failed', { dto: payload, reason: 'Insufficient booking information' });
            return;
        }

        // Store booking information next
        const appointment = await emitTyped<AppointmentBookingDto, AppointmentDocument>(
            this.eventEmitter,
                'appointment.store.booking',
                payload
            );
        
        console.log('[Saga] Stored appointment:', appointment);

        const appointmentId = appointment._id.toString();

        console.log('[Saga] Handling booking appointment for appointmentId:', appointmentId);

        let isPaymentSuccess: boolean = false;

        // First, check the payment method, check whether payment method is online, coin, or offline
        if (payload.paymentMethod === PaymentMethodEnum.ONLINE) {
            const amount = payload.amount ?? 0; // nếu undefined thì thành 0
            console.log(`[Saga] Processing online payment for amount: ${amount}`);
            if (amount > 0) {
                // Emit event tạo payment URL
                const paymentUrl = await emitTyped<
                    { amount: number; method: string; appointmentId: string },
                    string
                >(
                    this.eventEmitter,
                    'appointment.handle.payment',
                    { amount, method: payload.paymentMethod, appointmentId }
                );

                if (!paymentUrl) {
                    // Nếu tạo URL thất bại
                    this.eventEmitter.emit('appointment.payment.failed', { dto: payload });
                    console.log('Payment URL creation failed for appointment booking:', payload);
                    return;
                }

                // Emit event hoặc trả URL cho FE để redirect
                this.eventEmitter.emit('payment.vnpay.url.created', {
                    appointmentId,
                    paymentUrl,
                    email: payload.patientEmail
                });

                console.log('Payment URL created:', paymentUrl);
                return paymentUrl; // saga/controller có thể trả cho FE
            }
        } else if (payload.paymentMethod === PaymentMethodEnum.COIN) {
            const consultationFee = payload.amount ?? 0;
            const coinsToUse = payload.coinsToUse ?? 0;
            
            console.log(`[Saga] Processing coin payment for amount: ${coinsToUse} coins (consultation fee: ${consultationFee})`);
            
            // Validate: must pay full consultation fee using coins (no partials)
            if (coinsToUse < 0 || coinsToUse !== consultationFee) {
                console.log(`[Saga] Invalid coin payment: coins to use (${coinsToUse}) must equal consultation fee (${consultationFee})`);
                // Emit payment failed event
                this.eventEmitter.emit('appointment.payment.failed', { 
                    dto: payload, 
                    reason: `Coins to use (${coinsToUse}) must equal consultation fee (${consultationFee})`
                });
                return;
            }
            
            if (payload.useCoin && payload.coinsToUse && payload.coinsToUse > 0) {
                // Emit event để deduct coins
                this.eventEmitter.emit('appointment.booking.coin-deduction', {
                    appointmentId,
                    patientId: payload.patientId,
                    coinsUsed: payload.coinsToUse,
                    consultationFee: consultationFee,
                });

                // Fetch doctor and patient data to build enriched payload
                const doctor: Doctor = await emitTyped<string, Doctor>(
                    this.eventEmitter,
                    'doctor.get.byId',
                    appointment.doctorId?.toString()
                );

                const patient: Patient = await emitTyped<string, PatientDocument>(
                    this.eventEmitter,
                    'patient.get.byEmail',
                    appointment.patientEmail
                );

                const doctorProfile = doctor?.profileId as unknown as Profile;
                const patientProfile = patient?.profileId as unknown as Profile;

                const enrichedPayload = buildEnrichedAppointmentPayload(
                    appointment,
                    doctorProfile,
                    patientProfile,
                    payload.amount ?? 0,
                    patientProfile?.name || 'N/A',
                    appointment.patientEmail
                );

                enrichedPayload.paymentStatus = PaymentStatusEnum.COMPLETED;

                // Emit success event với enriched payload
                this.eventEmitter.emit('appointment.booking.success', enrichedPayload);
                console.log(`[Saga] Coin payment processed for appointment ${appointmentId}`);
                isPaymentSuccess = true;
            } else {
                console.log('Coin payment failed: insufficient coin information');
                this.eventEmitter.emit('appointment.payment.failed', { dto: payload });
                return;
            }
        } else if (payload.paymentMethod === PaymentMethodEnum.OFFLINE) {
            // Offline flow is deprecated; do not mark booking as success
            console.log(`[Saga] Offline payment is deprecated. Booking will not be marked as success: ${appointmentId}`);
            this.eventEmitter.emit('appointment.payment.failed', { dto: payload, reason: 'OFFLINE payment not supported' });
            return;
        } else {
            console.log(`[Saga] Unknown payment method: ${payload.paymentMethod}`);
            this.eventEmitter.emit('appointment.payment.failed', { dto: payload });
            return;
        }
    }

    isBookingInformationEnough(dto: AppointmentBookingDto) {
        // Kiểm tra tên bệnh viện
        if (!dto.hospitalName || dto.hospitalName.trim() === '') return false;

        // Kiểm tra khung giờ
        if (!dto.timeSlotId) return false;

        // Kiểm tra dịch vụ khám
        if (!dto.serviceType) return false;

        // Kiểm tra hình thức thanh toán
        if (!dto.paymentMethod) return false;

        // Nếu thanh toán online mà không có amount hoặc <= 0 → thiếu thông tin
        if (dto.paymentMethod === PaymentMethodEnum.ONLINE && (!dto.amount || dto.amount <= 0))
            return false;

        // Nếu có bác sĩ (optional) thì kiểm tra id và name có đầy đủ không
        if (dto.doctor) {
            if (!dto.doctor.id || dto.doctor.id.trim() === '') return false;
            if (!dto.doctor.name || dto.doctor.name.trim() === '') return false;
        }
        else
        {
            return false; // Bác sĩ là thông tin bắt buộc trong trường hợp này
        }

        // Ràng buộc bổ sung theo hình thức thanh toán
        if (dto.paymentMethod === PaymentMethodEnum.COIN) {
            const consultationFee = dto.amount ?? 0;
            const coinsToUse = dto.coinsToUse ?? 0;
            if (!dto.useCoin || coinsToUse <= 0 || coinsToUse !== consultationFee) return false;
        }

        // Mọi thứ hợp lệ
        return true;
    }
}