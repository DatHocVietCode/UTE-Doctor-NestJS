import { Injectable } from "@nestjs/common";
import { EventEmitter2, OnEvent } from "@nestjs/event-emitter";
import { AppointmentBookingDto } from "src/appointment/dto/appointment-booking.dto";
import { Appointment, AppointmentDocument } from "src/appointment/schemas/appointment.schema";
import { PaymentMethod } from "src/common/enum/paymentMethod.enum";
import { emitTyped } from "src/utils/helpers/event.helper";

@Injectable()
export class BookingAppointmentSubmitSaga {
    constructor (private readonly eventEmitter: EventEmitter2) {}
    // Impl happy case first, then add more complex logic later
    @OnEvent('appointment.booked') // received through http post
    async handleBookingAppointment(payload: AppointmentBookingDto) {
        const appointment = await emitTyped<AppointmentBookingDto, AppointmentDocument>(
            this.eventEmitter,
                'appointment.store.booking',
                payload
            );
        
        console.log('[Saga] Stored appointment:', appointment);

        const appointmentId = appointment._id.toString();

        console.log('[Saga] Handling booking appointment for appointmentId:', appointmentId);

        let isPaymentSuccess: boolean = false;

        // First, check the payment method, check whether payment method is online or offline
        if (payload.paymentMethod === PaymentMethod.ONLINE) {
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
        }

        // Cân nhắc bỏ, chờ FE thanh toán xong mới book
        if (this.isBookingInformationEnough(payload) && isPaymentSuccess)
        {
            this.eventEmitter.emit('appointment.booking.success', payload); // Noti to receptionst, and patient
            console.log('Booking completed');
        }
        else
        {
            this.eventEmitter.emit('appointment.booking.pending', payload); // Noti to receptionist, doctor and patient
            console.log('Booking pending');
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
        if (dto.patientEmail === 'ONLINE' && (!dto.amount || dto.amount <= 0))
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

        // Mọi thứ hợp lệ
        return true;
    }
}