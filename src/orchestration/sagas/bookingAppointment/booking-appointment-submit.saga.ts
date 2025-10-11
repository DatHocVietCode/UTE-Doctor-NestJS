import { Injectable } from "@nestjs/common";
import { EventEmitter2, OnEvent } from "@nestjs/event-emitter";
import { AppointmentBookingDto } from "src/appointment/dto/appointment-booking.dto";
import { HinhThucThanhToan } from "src/common/enum/hinh-thuc-thanh-toan.enum";
import { emitTyped } from "src/utils/helpers/event.helper";

@Injectable()
export class BookingAppointmentSubmitSaga {
    constructor (private readonly eventEmitter: EventEmitter2) {}
    // Impl happy case first, then add more complex logic later
    // 1. Check payment method
    // 2. If online, emit event to payment service to handle payment
    @OnEvent('appointment.booked') // received through http post
    async handleBookingAppointment(payload: AppointmentBookingDto) {;
        let isPaymentSuccess: boolean = false;

        // First, check the payment method, check whether payment method is online or offline
       if (payload.hinhThucThanhToan === HinhThucThanhToan.ONLINE) {
        const amount = payload.amount ?? 0; // nếu undefined thì thành 0

            if (amount > 0) {
                isPaymentSuccess = await emitTyped<{ amount: number }, boolean>(
                this.eventEmitter,
                'appointment.handle.payment',
                { amount }
                );
                if (!isPaymentSuccess) {
                    // Handle payment failure (e.g., notify user, log error, etc.) and emit event
                    this.eventEmitter.emit('appointment.payment.failed', { dto: payload });
                    console.log('Payment failed for appointment booking:', payload);
                    return;
                }
            }
        }

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
        if (!dto.tenBenhvien || dto.tenBenhvien.trim() === '') return false;

        // Kiểm tra khung giờ
        if (!dto.khungGio) return false;

        // Kiểm tra dịch vụ khám
        if (!dto.dichVuKham) return false;

        // Kiểm tra hình thức thanh toán
        if (!dto.hinhThucThanhToan) return false;

        // Nếu thanh toán online mà không có amount hoặc <= 0 → thiếu thông tin
        if (dto.hinhThucThanhToan === 'ONLINE' && (!dto.amount || dto.amount <= 0))
            return false;

        // Nếu có bác sĩ (optional) thì kiểm tra id và name có đầy đủ không
        if (dto.bacSi) {
            if (!dto.bacSi.id || dto.bacSi.id.trim() === '') return false;
            if (!dto.bacSi.name || dto.bacSi.name.trim() === '') return false;
        }

        // Mọi thứ hợp lệ
        return true;
    }

}