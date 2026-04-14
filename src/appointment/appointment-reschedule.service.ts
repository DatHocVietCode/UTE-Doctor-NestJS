import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { DataResponse } from 'src/common/dto/data-respone';
import { ResponseCode } from 'src/common/enum/reponse-code.enum';
import { RedisService } from 'src/common/redis/redis.service';
import { BOOKING_PENDING_TTL_SECONDS } from 'src/payment/vnpay/vnpay-timeout.config';
import { TimeSlotLog, TimeSlotLogDocument } from 'src/timeslot/schemas/timeslot-log.schema';
import { TimeHelper } from 'src/utils/helpers/time.helper';
import { AppointmentRescheduleDto } from './dto/appointment-reschedule.dto';
import { AppointmentStatus } from './enums/Appointment-status.enum';
import { Appointment, AppointmentDocument } from './schemas/appointment.schema';
import { AppointmentTimeHelper } from './utils/appointment-time.helper';

@Injectable()
export class AppointmentRescheduleService {
  private readonly logger = new Logger(AppointmentRescheduleService.name);

  constructor(
    private readonly redisService: RedisService,
    @InjectModel(Appointment.name) private readonly appointmentModel: Model<AppointmentDocument>,
    @InjectModel(TimeSlotLog.name) private readonly timeSlotLogModel: Model<TimeSlotLogDocument>,
  ) {}

  async rescheduleAppointment(dto: AppointmentRescheduleDto): Promise<DataResponse> {
    // Parse once and keep the normalized value through the whole flow.
    const normalizedAppointmentDate = TimeHelper.parseISOToUTC(dto.appointmentDate);

    const appointment = await this.appointmentModel.findById(dto.appointmentId);
    if (!appointment) {
      throw new NotFoundException('Appointment not found');
    }

    if (!appointment.doctorId) {
      throw new BadRequestException('Doctor is required for reschedule');
    }

    if (![AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED].includes(appointment.appointmentStatus)) {
      throw new BadRequestException(`Cannot reschedule appointment with status ${appointment.appointmentStatus}`);
    }

    const oldScheduledAt = AppointmentTimeHelper.resolveStoredScheduledAt(appointment);
    if (!oldScheduledAt) {
      throw new BadRequestException('Invalid appointment date');
    }

    if (oldScheduledAt <= Date.now()) {
      throw new BadRequestException('Cannot reschedule appointment to or from past time');
    }

    const targetSlot = await this.timeSlotLogModel.findById(dto.timeSlotId).select('start end status');
    if (!targetSlot) {
      throw new NotFoundException('TimeSlot not found');
    }

    const nextWindow = AppointmentTimeHelper.resolveTimeWindow(normalizedAppointmentDate, {
      start: targetSlot.start,
      end: targetSlot.end,
    });

    const oldSlotId = appointment.timeSlot?.toString();
    const isNoOp =
      oldSlotId === dto.timeSlotId &&
      appointment.scheduledAt === nextWindow.scheduledAt &&
      appointment.startTime === nextWindow.startTime &&
      appointment.endTime === nextWindow.endTime;

    if (isNoOp) {
      return {
        code: ResponseCode.SUCCESS,
        message: 'Appointment already has the requested schedule',
        data: {
          appointmentId: appointment._id.toString(),
          scheduledAt: appointment.scheduledAt,
          startTime: appointment.startTime,
          endTime: appointment.endTime,
          bookingDate: appointment.bookingDate,
        },
      };
    }

    if (nextWindow.scheduledAt <= Date.now()) {
      throw new BadRequestException('Cannot reschedule to past time');
    }

    const lockKey = this.getSlotKey(appointment.doctorId.toString(), dto.timeSlotId);
    const lockValue = `reschedule:${appointment._id.toString()}`;
    const lockAcquired = await this.redisService.acquireSlotLock(
      lockKey,
      lockValue,
      BOOKING_PENDING_TTL_SECONDS,
    );

    if (!lockAcquired) {
      return {
        code: ResponseCode.ERROR,
        message: 'Slot already booked',
        data: null,
      };
    }

    const session = await this.appointmentModel.db.startSession();
    try {
      await session.withTransaction(async () => {
        const fresh = await this.appointmentModel.findById(dto.appointmentId).session(session);
        if (!fresh) {
          throw new NotFoundException('Appointment not found');
        }

        if (![AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED].includes(fresh.appointmentStatus)) {
          throw new BadRequestException(`Cannot reschedule appointment with status ${fresh.appointmentStatus}`);
        }

        const conflict = await this.appointmentModel.findOne({
          _id: { $ne: fresh._id },
          doctorId: fresh.doctorId,
          timeSlot: new Types.ObjectId(dto.timeSlotId),
          appointmentStatus: { $in: [AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED] },
          $or: [
            { scheduledAt: nextWindow.scheduledAt },
            { date: nextWindow.scheduledAt },
          ],
        }).session(session).select('_id').lean();

        if (conflict) {
          throw this.buildSlotBookedError();
        }

        const previousSlotId = fresh.timeSlot?.toString();
        fresh.date = nextWindow.scheduledAt;
        fresh.scheduledAt = nextWindow.scheduledAt;
        fresh.startTime = nextWindow.startTime;
        fresh.endTime = nextWindow.endTime;
        fresh.timeSlot = new Types.ObjectId(dto.timeSlotId);
        fresh.appointmentStatus = AppointmentStatus.RESCHEDULED;
        await fresh.save({ session });

        if (previousSlotId && previousSlotId !== dto.timeSlotId) {
          await this.timeSlotLogModel.updateOne(
            { _id: new Types.ObjectId(previousSlotId) },
            { $set: { status: 'available' } },
            { session },
          );
        }

        await this.timeSlotLogModel.updateOne(
          { _id: new Types.ObjectId(dto.timeSlotId) },
          { $set: { status: 'booked' } },
          { session },
        );
      });

      return {
        code: ResponseCode.SUCCESS,
        message: 'Appointment rescheduled successfully',
        data: {
          appointmentId: appointment._id.toString(),
          appointmentDate: normalizedAppointmentDate.toISOString(),
          scheduledAt: nextWindow.scheduledAt,
          startTime: nextWindow.startTime,
          endTime: nextWindow.endTime,
          bookingDate: appointment.bookingDate,
          reason: dto.reason,
        },
      };
    } catch (error: any) {
      if (error?.message === 'SLOT_ALREADY_BOOKED') {
        return { code: ResponseCode.ERROR, message: 'Slot already booked', data: null };
      }

      if (error?.code === 11000) {
        return { code: ResponseCode.ERROR, message: 'Slot already booked', data: null };
      }

      this.logger.error(`Reschedule failed: ${error?.message || String(error)}`);
      throw error;
    } finally {
      await session.endSession();
      await this.redisService.releaseSlotLock(lockKey, lockValue);
    }
  }

  private getSlotKey(doctorId: string, timeSlotId: string) {
    return `slot:${doctorId}:${timeSlotId}`;
  }

  private buildSlotBookedError() {
    return new Error('SLOT_ALREADY_BOOKED');
  }
}
