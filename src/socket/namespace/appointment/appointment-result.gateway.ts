import { OnEvent } from '@nestjs/event-emitter';
import { WebSocketGateway } from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import type { AppointmentEnriched } from 'src/appointment/schemas/appointment-enriched';
import { DataResponse } from 'src/common/dto/data-respone';
import { ResponseCode } from 'src/common/enum/reponse-code.enum';
import { SocketEventsEnum } from 'src/common/enum/socket-events.enum';
import { BaseGateway } from '../../base/base.gateway';
import { SocketRoomService } from '../../socket.service';

@WebSocketGateway({ cors: true, namespace: '/appointment' })
export class AppointmentGateway extends BaseGateway {

   constructor(socketRoomService: SocketRoomService, jwtService: JwtService) {
        super(socketRoomService, jwtService);
    }

  @OnEvent('socket.appointment.success')
  handleCompleted(payload: AppointmentEnriched) {
    const res: DataResponse = {
      code: ResponseCode.SUCCESS,
      message: 'Appointment booking completed',
      data: payload,
    };
    console.log('[Socket][Appointment] Push COMPLETED to doctor');
    this.emitToRoom(payload.doctorEmail!, SocketEventsEnum.APPOINTMENT_BOOKING_SUCCESS, res); // Emit to doctor
    console.log('[Socket][Appointment] Push COMPLETED to patient');
    this.emitToRoom(payload.patientEmail, SocketEventsEnum.APPOINTMENT_BOOKING_SUCCESS, res); // Emit to patient
  }

  @OnEvent('socket.appointment.pending')
  handlePending(payload: AppointmentEnriched) {
    const res: DataResponse = {
      code: ResponseCode.SUCCESS,
      message: 'Appointment booking pending',
      data: payload,
    };
    console.log('[Socket][Appointment] Push PENDING to receptionist');
    // this.emitToRoom(payload.receptionistEmail, SocketEventsEnum.APPOINTMENT_PENDING, res); // Dont have receptionist yet
    console.log('[Socket][Appointment] Push PENDING to patient');
    this.emitToRoom(payload.patientEmail, SocketEventsEnum.APPOINTMENT_BOOKING_PENDING, res); // Emit to patient
  }

  @OnEvent('socket.appointment.failed')
  handleFailed(payload: { success: boolean; error: string; appointmentId?: string; patientEmail?: string }) {
    const res: DataResponse = {
      code: ResponseCode.ERROR,
      message: payload.error || 'Appointment booking failed',
      data: payload,
    };
    console.log('[Socket][Appointment] Push FAILED to patient');
    this.emitToRoom(payload.patientEmail || '', SocketEventsEnum.APPOINTMENT_BOOKING_FAILED, res); // Emit to patient
  }

  @OnEvent('socket.shift.cancelled')
  handleShiftCancelled(payload: {
    appointmentId: string;
    patientEmail: string;
    doctorEmail?: string;
    date: string;
    timeSlot: string;
    hospitalName?: string;
    reason?: string;
  }) {
    const res: DataResponse = {
      code: ResponseCode.SUCCESS,
      message: 'Shift cancelled',
      data: payload,
    };
    console.log('[Socket][Appointment] Push SHIFT_CANCELLED to patient');
    this.emitToRoom(payload.patientEmail, SocketEventsEnum.SHIFT_CANCELLED, res);
    if (payload.doctorEmail) {
      console.log('[Socket][Appointment] Push SHIFT_CANCELLED to doctor');
      this.emitToRoom(payload.doctorEmail, SocketEventsEnum.SHIFT_CANCELLED, res);
    }
  }

  @OnEvent('socket.appointment.cancelled')
  handleAppointmentCancelled(payload: {
    appointmentId: string;
    patientEmail: string;
    doctorEmail?: string;
    date: string;
    timeSlot: string;
    timeSlotLabel?: string;
    hospitalName?: string;
    reason?: string;
    refundAmount?: number;
    shouldRefund?: boolean;
  }) {
    const res: DataResponse = {
      code: ResponseCode.SUCCESS,
      message: 'Appointment cancelled',
      data: payload,
    };

    console.log('[Socket][Appointment] Push APPOINTMENT_CANCELLED to patient');
    this.emitToRoom(payload.patientEmail, SocketEventsEnum.APPOINTMENT_CANCELLED, res);

    if (payload.doctorEmail) {
      console.log('[Socket][Appointment] Push APPOINTMENT_CANCELLED to doctor');
      this.emitToRoom(payload.doctorEmail, SocketEventsEnum.APPOINTMENT_CANCELLED, res);
    }
  }
}
