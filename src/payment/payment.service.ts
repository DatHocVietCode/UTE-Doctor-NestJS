import { Injectable } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";


@Injectable()
export class PaymentService {

    // Listen to the event emitted when an appointment is booked
    @OnEvent('appointment.handle.payment')
    async processPayment(payload: any) {
        // Simulate payment processing logic here
        console.log('Processing payment for appointment:', payload);
        // For demonstration, we'll assume the payment is always successful
        return true; // In a real scenario, implement actual payment logic and return the result
    }
}