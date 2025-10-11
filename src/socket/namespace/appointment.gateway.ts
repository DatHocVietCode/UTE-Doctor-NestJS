import { OnEvent } from '@nestjs/event-emitter';
import { WebSocketGateway } from '@nestjs/websockets';
import { DataResponse } from 'src/common/dto/data-respone';
import { ResponseCode } from 'src/common/enum/reponse-code.enum';
import { SocketEventsEnum } from 'src/common/enum/socket-events.enum';
import { BaseGateway } from '../base/base.gateway';
import { SocketRoomService } from '../socket.service';
import { AppointmentBookingDto } from 'src/appointment/dto/appointment-booking.dto';

@WebSocketGateway({ cors: true, namespace: '/appointment' })
export class AppointmentGateway extends BaseGateway {

   constructor(socketRoomService: SocketRoomService) {
        super(socketRoomService);
    }

  @OnEvent('socket.appointment.success')
  handleCompleted(payload: AppointmentBookingDto) {
    const res: DataResponse = {
      code: ResponseCode.SUCCESS,
      message: 'Appointment booking completed',
      data: payload,
    };
    console.log('[Socket][Appointment] Push COMPLETED to doctor');
    this.emitToRoom(payload.bacSi!.email, SocketEventsEnum.APPOINTMENT_COMPLETED, res); // Emit to doctor
    console.log('[Socket][Appointment] Push COMPLETED to patient');
    this.emitToRoom(payload.patientEmail, SocketEventsEnum.APPOINTMENT_COMPLETED, res); // Emit to patient
  }

  @OnEvent('appointment.socket.notify.pending')
  handlePending(payload: any) {
    const res: DataResponse = {
      code: ResponseCode.SUCCESS,
      message: 'Appointment booking pending',
      data: payload,
    };
    console.log('[Socket][Appointment] Push PENDING to receptionist');
    this.emitToRoom(payload.receptionistEmail, SocketEventsEnum.APPOINTMENT_PENDING, res);
  }
}
