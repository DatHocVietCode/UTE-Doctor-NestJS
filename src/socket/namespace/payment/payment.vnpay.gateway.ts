import { EventEmitter2, OnEvent } from "@nestjs/event-emitter";
import { WebSocketGateway } from "@nestjs/websockets";
import { SocketEventsEnum } from "src/common/enum/socket-events.enum";
import { BaseGateway } from "src/socket/base/base.gateway";
import { SocketRoomService } from "src/socket/socket.service";


@WebSocketGateway({ namespace: '/payment/vnpay' })
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
            SocketEventsEnum.PAYMENT_VNPAY_URL_CREATED,
            { appointmentId: payload.appointmentId, paymentUrl: payload.paymentUrl }
        );
        console.log(`[Socket][Payment][VnPay] Sent payment URL to ${payload.email}`);
    }
}