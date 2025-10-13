// appointment-booking.gateway.ts
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
    ConnectedSocket,
    MessageBody,
    SubscribeMessage,
    WebSocketGateway,
    WebSocketServer
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { DoctorDto } from 'src/appointment/dto/appointment-booking.dto';
import { DoctorService } from 'src/doctor/doctor.service';
import { emitTyped } from 'src/utils/helpers/event.helper';
import { EventEmitter } from 'stream';


@WebSocketGateway({
  namespace: '/appointment/booking',
  cors: true,
})
export class AppointmentBookingGateway {
  @WebSocketServer() server: Server;

  constructor(private readonly eventEmitter: EventEmitter2
  ) {}

  // Khi FE chọn chuyên khoa
  @SubscribeMessage('get_doctors_by_specialty')
  async handleGetDoctors(
    @MessageBody() data: { specialtyId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const doctors = await emitTyped<{ specialtyId: string }, DoctorDto[]>(
      this.eventEmitter,
      'doctor.update-list-by-specialty',
      { specialtyId: data.specialtyId }
    );
    client.emit('doctor_list', doctors);
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
}
