import { SocketEventsEnum } from 'src/common/enum/socket-events.enum';
import { AppointmentGateway } from './appointment-result.gateway';

describe('AppointmentGateway cancellation realtime', () => {
  it('forwards assignment-timeout metadata in APPOINTMENT_CANCELLED payloads', () => {
    const gateway = new AppointmentGateway({} as any, {} as any);
    const emitToRoom = jest
      .spyOn(gateway as any, 'emitToRoom')
      .mockImplementation(jest.fn());

    gateway.handleAppointmentCancelled({
      appointmentId: 'appt-1',
      patientEmail: 'patient@x.com',
      date: 1700000000000,
      timeSlot: '',
      actor: 'SYSTEM',
      reasonCode: 'ASSIGNMENT_TIMEOUT',
      assignmentTaskId: 'task-1',
      deadlineAt: 1700003600000,
    });

    expect(emitToRoom).toHaveBeenCalledWith(
      'patient@x.com',
      SocketEventsEnum.APPOINTMENT_CANCELLED,
      expect.objectContaining({
        data: expect.objectContaining({
          actor: 'SYSTEM',
          reasonCode: 'ASSIGNMENT_TIMEOUT',
          assignmentTaskId: 'task-1',
          deadlineAt: 1700003600000,
        }),
      }),
    );
  });
});
