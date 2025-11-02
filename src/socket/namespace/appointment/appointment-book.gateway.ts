// appointment-booking.gateway.ts
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import {
    ConnectedSocket,
    MessageBody,
    SubscribeMessage,
    WebSocketGateway,
    WebSocketServer
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { DoctorDto } from 'src/appointment/dto/appointment-booking.dto';
import { SocketEventsEnum } from 'src/common/enum/socket-events.enum';
import { BaseGateway } from 'src/socket/base/base.gateway';
import { SocketRoomService } from 'src/socket/socket.service';
import { emitTyped } from 'src/utils/helpers/event.helper';

@WebSocketGateway({
  namespace: '/appointment/fields-data',
  cors: true,
})
export class AppointmentBookingGateway extends BaseGateway {
 
  constructor(private readonly eventEmitter: EventEmitter2,
            socketRoomService: SocketRoomService
  ) {
    super(socketRoomService);
  }

  // Khi FE chọn bác sĩ
  @SubscribeMessage('get_timeslots_by_doctor')
  async handleGetTimeSlots(
    @MessageBody() data: { doctorId: string },
    @ConnectedSocket() client: Socket,
  ) {
    // const timeslots = await this.timeSlotService.findByDoctor(data.doctorId);
    // client.emit('timeslot_list', timeslots);
  }

  @OnEvent('appointment.hospitals-specialties.fetched')
  async handleFieldsDataFetched(payload: { hospitals: string[]; specialties: { id: string; name: string }[], email: string }) {
    this.emitToRoom(payload.email, SocketEventsEnum.HOSPITAL_SPECIALTIES_FETCHED, { hospitals: payload.hospitals, specialties: payload.specialties });
    console.log(`[Socket][Appointment] Sent fields data to ${payload.email}`);
  }

  @OnEvent('doctor.list.fetched')
  async handleDoctorListFetched(payload: {doctors: any[], email: string}) {
    // Emit to all clients in the room
    this.emitToRoom(payload.email, SocketEventsEnum.DOCTOR_LIST_FETCHED, payload.doctors);
    console.log(`[Socket][Appointment] Sent doctors list to room appointment`);
  }
}
