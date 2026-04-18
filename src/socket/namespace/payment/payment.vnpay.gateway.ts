import { EventEmitter2, OnEvent } from "@nestjs/event-emitter";
import { WebSocketGateway } from "@nestjs/websockets";
import { SocketEventsEnum } from "src/common/enum/socket-events.enum";
import { BaseGateway } from "src/socket/base/base.gateway";
import { PresenceService } from "src/socket/presence.service";
import { SocketRoomService } from "src/socket/socket.service";


@WebSocketGateway({ cors: true, namespace: '/payment/vnpay' })
export class VnPayGateway extends BaseGateway {
    constructor(
        private readonly eventEmitter: EventEmitter2,
        socketRoomService: SocketRoomService,
        presenceService: PresenceService,
    ) {
        super(socketRoomService, presenceService);
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

    @OnEvent('payment.update')
    async handlePaymentUpdate(payload: { orderId: string; status: 'COMPLETED' | 'FAILED' }) {
        this.emitToAll(SocketEventsEnum.PAYMENT_UPDATE, payload);
        console.log(`[Socket][Payment] Broadcast payment:update for order ${payload.orderId} status ${payload.status}`);
    }
}