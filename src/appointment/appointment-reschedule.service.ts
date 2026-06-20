import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Billing, BillingDocument } from 'src/billing/billing.schema';
import { DataResponse } from 'src/common/dto/data-respone';
import { ResponseCode } from 'src/common/enum/reponse-code.enum';
import { RedisService } from 'src/common/redis/redis.service';
import { MedicalEncounter, MedicalEncounterDocument } from 'src/patient/schema/medical-record.schema';
import { PaymentPurposeEnum } from 'src/payment/enums/payment-flow.enum';
import { Payment, PaymentDocument } from 'src/payment/schemas/payment.schema';
import { BOOKING_PENDING_TTL_SECONDS } from 'src/payment/vnpay/vnpay-timeout.config';
import { Shift, ShiftDocument } from 'src/shift/schema/shift.schema';
import { TimeSlotLog, TimeSlotLogDocument } from 'src/timeslot/schemas/timeslot-log.schema';
import { TimeHelper } from 'src/utils/helpers/time.helper';
import { VisitStatus } from 'src/visit/enums/visit-status.enum';
import { Visit, VisitDocument } from 'src/visit/schemas/visit.schema';
import { RescheduleInput } from './dto/appointment-reschedule.dto';
import { AppointmentStatus } from './enums/Appointment-status.enum';
import { Appointment, AppointmentDocument } from './schemas/appointment.schema';
import { AppointmentTimeHelper } from './utils/appointment-time.helper';

@Injectable()
export class AppointmentRescheduleService {
  private readonly logger = new Logger(AppointmentRescheduleService.name);

  constructor(
    private readonly eventEmitter: EventEmitter2,
    private readonly redisService: RedisService,
    @InjectModel(Appointment.name) private readonly appointmentModel: Model<AppointmentDocument>,
    @InjectModel(TimeSlotLog.name) private readonly timeSlotLogModel: Model<TimeSlotLogDocument>,
    @InjectModel(Shift.name) private readonly shiftModel: Model<ShiftDocument>,
    @InjectModel(Visit.name) private readonly visitModel: Model<VisitDocument>,
    @InjectModel(MedicalEncounter.name) private readonly encounterModel: Model<MedicalEncounterDocument>,
    @InjectModel(Billing.name) private readonly billingModel: Model<BillingDocument>,
    @InjectModel(Payment.name) private readonly paymentModel: Model<PaymentDocument>,
  ) {}

  async rescheduleAppointment(input: RescheduleInput): Promise<DataResponse> {
    // Parse and normalize appointmentDate once; used throughout the flow.
    const normalizedAppointmentDate = TimeHelper.parseISOToUTC(input.appointmentDate);

    // --- 1. Load and validate Appointment ---
    const appointment = await this.appointmentModel.findById(input.appointmentId);
    if (!appointment) {
      throw new NotFoundException('Appointment not found');
    }

    if (!appointment.doctorId) {
      this.throwBlocked(
        'APPOINTMENT_DOCTOR_NOT_ASSIGNED',
        'Appointment has no assigned doctor; reschedule is not allowed',
      );
    }

    if (![AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED].includes(appointment.appointmentStatus)) {
      this.throwBlocked(
        'APPOINTMENT_NOT_RESCHEDULABLE',
        `Cannot reschedule appointment with status ${appointment.appointmentStatus}`,
      );
    }

    // A past appointment cannot be rescheduled; its time has already lapsed (it is a no-show
    // candidate, not a reschedule candidate). Prefer the slot end snapshot when available.
    const originBoundary =
      typeof appointment.endTime === 'number' && Number.isFinite(appointment.endTime)
        ? appointment.endTime
        : AppointmentTimeHelper.resolveStoredScheduledAt(appointment);
    if (originBoundary != null && originBoundary < Date.now()) {
      this.throwBlocked(
        'APPOINTMENT_TIME_PASSED',
        'Cannot reschedule an appointment whose scheduled time has already passed',
      );
    }

    // --- 2. Visit lifecycle guard: reschedule is allowed only while Visit.status === CREATED ---
    const visit = await this.visitModel
      .findOne({ appointmentId: appointment._id })
      .select('_id status')
      .lean();

    if (!visit) {
      // A visit must exist before reschedule (created by booking.success listener).
      this.throwBlocked(
        'APPOINTMENT_NOT_RESCHEDULABLE',
        'No visit record found for this appointment',
      );
    }

    if (visit.status === VisitStatus.COMPLETED || visit.status === VisitStatus.CANCELLED) {
      this.throwBlocked(
        'VISIT_COMPLETED',
        `Visit is already ${visit.status}; reschedule not allowed`,
      );
    }

    if (visit.status !== VisitStatus.CREATED) {
      // CHECKED_IN or IN_PROGRESS: visit has started, cannot reschedule.
      this.throwBlocked(
        'VISIT_ALREADY_STARTED',
        `Visit has already started (status: ${visit.status}); reschedule not allowed`,
      );
    }

    // --- 3. Guard against downstream clinical/financial records ---
    const encounterExists = await this.encounterModel.exists({
      $or: [{ visitId: visit._id }, { appointmentId: appointment._id }],
    });
    if (encounterExists) {
      this.throwBlocked(
        'MEDICAL_ENCOUNTER_EXISTS',
        'Medical encounter already exists for this visit; reschedule not allowed',
      );
    }

    const billing = await this.billingModel
      .findOne({ visitId: visit._id })
      .select('_id')
      .lean();

    if (billing) {
      // Check for a payment linked to the billing for a more specific reason code.
      const paymentExists = await this.paymentModel.exists({
        purpose: PaymentPurposeEnum.BILLING,
        billingId: billing._id,
      });
      if (paymentExists) {
        this.throwBlocked(
          'PAYMENT_EXISTS',
          'A payment record exists for this visit billing; reschedule not allowed',
        );
      }
      this.throwBlocked(
        'BILLING_EXISTS',
        'Billing record exists for this visit; reschedule not allowed',
      );
    }

    // --- 4. Validate old schedule is sane (guards against corrupted records) ---
    const oldScheduledAt = AppointmentTimeHelper.resolveStoredScheduledAt(appointment);
    if (!oldScheduledAt) {
      this.throwBlocked('INVALID_SCHEDULE', 'Current appointment date is invalid');
    }

    // --- 5. Resolve new time window from the requested slot ---
    const targetSlot = await this.timeSlotLogModel
      .findById(input.timeSlotId)
      .select('start end status');
    if (!targetSlot) {
      throw new NotFoundException('TimeSlot not found');
    }

    const nextWindow = AppointmentTimeHelper.resolveTimeWindow(normalizedAppointmentDate, {
      start: targetSlot.start,
      end: targetSlot.end,
    });

    // No-op: same slot and same schedule — return success without touching anything.
    const oldSlotId = appointment.timeSlot?.toString();
    const isNoOp =
      oldSlotId === input.timeSlotId &&
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

    // --- 6. Guard: slot must belong to the appointment's doctor (via Shift.timeSlots[]) ---
    const shiftOwner = await this.shiftModel
      .findOne({
        doctorId: appointment.doctorId,
        timeSlots: new Types.ObjectId(input.timeSlotId),
      })
      .select('_id')
      .lean();

    if (!shiftOwner) {
      this.throwBlocked(
        'SLOT_DOCTOR_MISMATCH',
        'The selected slot does not belong to the appointment doctor',
      );
    }

    if (nextWindow.scheduledAt <= Date.now()) {
      this.throwBlocked('INVALID_SCHEDULE', 'Cannot reschedule to a past time');
    }

    // --- 7. Acquire Redis lock on the new slot before opening the transaction ---
    const lockKey = this.getSlotLockKey(appointment.doctorId.toString(), input.timeSlotId);
    const lockValue = `reschedule:${appointment._id.toString()}`;
    const lockAcquired = await this.redisService.acquireSlotLock(
      lockKey,
      lockValue,
      BOOKING_PENDING_TTL_SECONDS,
    );

    if (!lockAcquired) {
      return {
        code: ResponseCode.ERROR,
        message: 'Slot is currently held by another booking',
        data: { blockedReason: 'SLOT_UNAVAILABLE' },
      };
    }

    const session = await this.appointmentModel.db.startSession();
    try {
      await session.withTransaction(async () => {
        // Re-fetch inside transaction for optimistic concurrency safety.
        const fresh = await this.appointmentModel.findById(input.appointmentId).session(session);
        if (!fresh) throw new NotFoundException('Appointment not found');

        if (![AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED].includes(fresh.appointmentStatus)) {
          this.throwBlocked(
            'APPOINTMENT_NOT_RESCHEDULABLE',
            `Cannot reschedule appointment with status ${fresh.appointmentStatus}`,
          );
        }

        // Conflict check: another appointment for the same doctor already holds this slot.
        const conflict = await this.appointmentModel
          .findOne({
            _id: { $ne: fresh._id },
            doctorId: fresh.doctorId,
            timeSlot: new Types.ObjectId(input.timeSlotId),
            appointmentStatus: { $in: [AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED] },
            $or: [{ scheduledAt: nextWindow.scheduledAt }, { date: nextWindow.scheduledAt }],
          })
          .session(session)
          .select('_id')
          .lean();

        if (conflict) {
          // Use a sentinel so the outer catch can map it to SLOT_UNAVAILABLE.
          throw new Error('SLOT_ALREADY_BOOKED');
        }

        const previousSlotId = fresh.timeSlot?.toString();

        // Update schedule snapshot fields only.
        // appointmentStatus is intentionally NOT changed — must remain CONFIRMED or PENDING.
        // All financial/deposit/payment fields are untouched.
        fresh.date = nextWindow.scheduledAt;
        fresh.scheduledAt = nextWindow.scheduledAt;
        fresh.startTime = nextWindow.startTime;
        fresh.endTime = nextWindow.endTime;
        fresh.timeSlot = new Types.ObjectId(input.timeSlotId);
        await fresh.save({ session });

        // Release old slot only when the slot actually changed.
        if (previousSlotId && previousSlotId !== input.timeSlotId) {
          await this.timeSlotLogModel.updateOne(
            { _id: new Types.ObjectId(previousSlotId) },
            { $set: { status: 'available' } },
            { session },
          );
        }

        await this.timeSlotLogModel.updateOne(
          { _id: new Types.ObjectId(input.timeSlotId) },
          { $set: { status: 'booked' } },
          { session },
        );
      });

      // Structured audit log: at minimum one log line per AGENTS.md commenting rule.
      this.logger.log(
        `[Reschedule] appointmentId=${appointment._id} rescheduledBy=${input.rescheduledBy ?? 'unknown'} ` +
          `oldSlot=${oldSlotId} newSlot=${input.timeSlotId} ` +
          `oldScheduledAt=${oldScheduledAt} newScheduledAt=${nextWindow.scheduledAt} ` +
          `reason="${input.reason ?? ''}"`,
      );

      // Notify downstream listeners about the schedule change.
      // Do NOT emit appointment.booking.success — that would trigger a new Visit and wallet ops.
      this.eventEmitter.emit('appointment.rescheduled', {
        appointmentId: appointment._id.toString(),
        patientEmail: appointment.patientEmail,
        doctorId: appointment.doctorId?.toString(),
        hospitalName: appointment.hospitalName,
        oldScheduledAt,
        newScheduledAt: nextWindow.scheduledAt,
        newStartTime: nextWindow.startTime,
        newEndTime: nextWindow.endTime,
        oldTimeSlotId: oldSlotId,
        newTimeSlotId: input.timeSlotId,
        reason: input.reason,
        rescheduledBy: input.rescheduledBy,
        rescheduledAt: Date.now(),
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
          // Return the preserved status to confirm it was not changed to RESCHEDULED.
          appointmentStatus: appointment.appointmentStatus,
          reason: input.reason,
        },
      };
    } catch (error: any) {
      if (error?.message === 'SLOT_ALREADY_BOOKED') {
        return {
          code: ResponseCode.ERROR,
          message: 'Slot already booked',
          data: { blockedReason: 'SLOT_UNAVAILABLE' },
        };
      }
      // Duplicate key: the unique index on (doctorId, date, timeSlot) caught a conflict.
      if (error?.code === 11000) {
        return {
          code: ResponseCode.ERROR,
          message: 'Slot already booked',
          data: { blockedReason: 'SLOT_UNAVAILABLE' },
        };
      }
      this.logger.error(`Reschedule failed: ${error?.message || String(error)}`);
      throw error;
    } finally {
      await session.endSession();
      // Always release the Redis lock; keep old/new slot state consistent through the transaction.
      await this.redisService.releaseSlotLock(lockKey, lockValue);
    }
  }

  private getSlotLockKey(doctorId: string, timeSlotId: string): string {
    return `slot:${doctorId}:${timeSlotId}`;
  }

  // Mirrors throwCancelBlocked in AppointmentService; keeps error shape consistent.
  private throwBlocked(blockedReason: string, message: string): never {
    throw new BadRequestException({
      code: ResponseCode.ERROR,
      message,
      data: { blockedReason },
    });
  }
}
