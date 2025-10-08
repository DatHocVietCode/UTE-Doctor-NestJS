import { EventEmitter2, OnEvent } from "@nestjs/event-emitter";
import { emitTyped } from "src/utils/helpers/event.helper";


export class BookingAppointmentSubmit {
    constructor (private readonly eventEmitter: EventEmitter2) {}

    @OnEvent('appointment.received') // received through http post
    async handleBookingAppointment(payload: any) {;
        let isPaymentSuccess: boolean = false;
        // First, check the payment method, check whether payment method is online or offline
        if (payload.paymentMethod === 'ONLINE')
        {
            isPaymentSuccess = await emitTyped<{amount: Number}, boolean>(this.eventEmitter, 
                'appointment.handle.payment', 
                { amount: payload.amount }); // and impl fallback handle
            return;
        }

        // Second, push notification to doctor and receptionist
        this.eventEmitter.emit('appointment.notify') // maybe not need to impl fallback case here?

        // Third, check if all fields in dto, include optional field is (un)completed,  push pending / success status to client
        if (this.isBookingInformationEnough() && isPaymentSuccess)
        {
            this.eventEmitter.emit('appointment.booking.completed'); // Noti to receptionst, and patient
        }
        else
        {
            this.eventEmitter.emit('appointment.booking.pending'); // Noti to receptionist, doctor and patient
        }
    }

    async handlePaymentFailed(payload: any) {
        // TODO: impl payment fail handle
    }

    isBookingInformationEnough() {
        // TODO: if all field is valid (not blank, bla bla)
        return true;
    }
}