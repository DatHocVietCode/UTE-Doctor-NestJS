import { EventEmitter2, OnEvent } from "@nestjs/event-emitter";
import { WebSocketGateway } from "@nestjs/websockets";
import { BaseGateway } from "src/socket/base/base.gateway";
import { SocketRoomService } from "src/socket/socket.service";


@WebSocketGateway({ namespace: 'payment/vnpay' })
export class VnPayGateway extends BaseGateway {
    constructor(
        private readonly eventEmitter: EventEmitter2,
        socketRoomService: SocketRoomService
    ) {
        super(socketRoomService);
    }

    @OnEvent('payment.vnpay.url.created')
    async handleVnPayUrlCreated(payload: { appointmentId: string; paymentUrl: string; email: string }) {
        this.emitToRoom(
            payload.email,
            'vnpay_payment_url',
            { appointmentId: payload.appointmentId, paymentUrl: payload.paymentUrl }
        );
        console.log(`[Socket][Payment][VnPay] Sent payment URL to ${payload.email}`);
    }
}