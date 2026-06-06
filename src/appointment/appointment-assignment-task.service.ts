import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { DataResponse } from 'src/common/dto/data-respone';
import { ResponseCode } from 'src/common/enum/reponse-code.enum';
import { RedisService } from 'src/common/redis/redis.service';
import { Doctor, DoctorDocument } from 'src/doctor/schema/doctor.schema';
import { Patient, PatientDocument } from 'src/patient/schema/patient.schema';
import { PaymentStatusEnum } from 'src/payment/enums/payment-status.enum';
import { BOOKING_PENDING_TTL_SECONDS } from 'src/payment/vnpay/vnpay-timeout.config';
import { Shift, ShiftDocument } from 'src/shift/schema/shift.schema';
import { TimeSlotLog, TimeSlotLogDocument } from 'src/timeslot/schemas/timeslot-log.schema';
import { TimeHelper } from 'src/utils/helpers/time.helper';
import { AppointmentStatus } from './enums/Appointment-status.enum';
import { AssignmentStatus } from './enums/assignment-status.enum';
import { AssignmentTaskStatus } from './enums/assignment-task-status.enum';
import { DepositStatus } from './enums/deposit-status.enum';
import { PaymentCategory } from './enums/payment-category.enum';
import {
  AppointmentAssignmentTask,
  AppointmentAssignmentTaskDocument,
  AssignmentTaskHistoryEntry,
} from './schemas/appointment-assignment-task.schema';
import { buildEnrichedAppointmentPayload } from './schemas/appointment-enriched';
import { Appointment, AppointmentDocument } from './schemas/appointment.schema';
import { AppointmentTimeHelper } from './utils/appointment-time.helper';

export interface ListAssignmentTasksQuery {
  status?: string;
  specialty?: string;
  page?: number;
  limit?: number;
}

export interface AssignDoctorSlotInput {
  doctorId: string;
  timeSlotId: string;
  appointmentDate: string;
}

/**
 * Receptionist-facing queue management for broad-appointment assignment tasks.
 *
 * Batch 3 scope: list / detail / accept / release. No doctor-slot assignment,
 * no cron/SLA, no notification fan-out yet.
 */
@Injectable()
export class AppointmentAssignmentTaskService {
  private readonly logger = new Logger(AppointmentAssignmentTaskService.name);
  // Short-lived task lock so two receptionists cannot process the same task concurrently.
  private readonly TASK_LOCK_TTL_SECONDS = 30;

  constructor(
    @InjectModel(AppointmentAssignmentTask.name)
    private readonly taskModel: Model<AppointmentAssignmentTaskDocument>,
    @InjectModel(Appointment.name)
    private readonly appointmentModel: Model<AppointmentDocument>,
    @InjectModel(TimeSlotLog.name)
    private readonly timeSlotLogModel: Model<TimeSlotLogDocument>,
    @InjectModel(Shift.name)
    private readonly shiftModel: Model<ShiftDocument>,
    @InjectModel(Doctor.name)
    private readonly doctorModel: Model<DoctorDocument>,
    @InjectModel(Patient.name)
    private readonly patientModel: Model<PatientDocument>,
    private readonly redisService: RedisService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async listTasks(query: ListAssignmentTasksQuery): Promise<DataResponse> {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.max(1, Math.min(100, Number(query.limit) || 20));
    const status = query.status || AssignmentTaskStatus.PENDING;

    const filter: FilterQuery<AppointmentAssignmentTaskDocument> = { status };
    if (query.specialty) {
      filter.specialty = query.specialty;
    }

    const [items, total] = await Promise.all([
      this.taskModel
        .find(filter)
        // Oldest-first within a status so the queue is processed fairly (FIFO).
        .sort({ createdAt: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      this.taskModel.countDocuments(filter),
    ]);

    return {
      code: ResponseCode.SUCCESS,
      message: 'Fetched assignment tasks successfully',
      data: {
        items,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    };
  }

  async getTaskDetail(taskId: string): Promise<DataResponse> {
    const task = await this.findByIdOrThrow(taskId);
    return {
      code: ResponseCode.SUCCESS,
      message: 'Fetched assignment task successfully',
      data: task,
    };
  }

  /**
   * Atomically lock a PENDING task to the calling receptionist. The single
   * conditional findOneAndUpdate guarantees exactly one winner under concurrent
   * accepts; a null result means the caller lost the race (or the task moved on).
   */
  async acceptTask(taskId: string, receptionistId: string): Promise<DataResponse> {
    this.assertValidId(taskId);
    // Redis task lock prevents two receptionists from racing on the same task; the atomic
    // findOneAndUpdate below is the second-layer DB guard if the lock ever lapses.
    return this.withTaskLock(taskId, receptionistId, () =>
      this.acceptTaskInternal(taskId, receptionistId),
    );
  }

  private async acceptTaskInternal(
    taskId: string,
    receptionistId: string,
  ): Promise<DataResponse> {
    const acceptorId = this.toReceptionistId(receptionistId);
    const now = Date.now();

    const updated = await this.taskModel.findOneAndUpdate(
      { _id: taskId, status: AssignmentTaskStatus.PENDING },
      {
        $set: {
          status: AssignmentTaskStatus.ASSIGNED,
          acceptedByReceptionistId: acceptorId,
          acceptedAt: now,
        },
        $push: {
          history: this.historyEntry(
            now,
            AssignmentTaskStatus.PENDING,
            AssignmentTaskStatus.ASSIGNED,
            receptionistId,
            'accepted',
          ),
        },
      },
      { new: true },
    );

    if (!updated) {
      // Disambiguate the failure for the FE.
      const existing = await this.taskModel.findById(taskId).select('status').lean();
      if (!existing) {
        this.throwBlocked('TASK_NOT_FOUND', 'Assignment task not found', true);
      }
      if (existing!.status === AssignmentTaskStatus.ASSIGNED) {
        this.throwBlocked('TASK_ALREADY_ACCEPTED', 'Assignment task has already been accepted');
      }
      this.throwBlocked(
        'TASK_NOT_PENDING',
        `Assignment task is not pending (current status: ${existing!.status})`,
      );
    }

    this.logger.log(`[Assignment] task=${taskId} accepted by receptionist=${receptionistId}`);

    return {
      code: ResponseCode.SUCCESS,
      message: 'Assignment task accepted',
      data: {
        taskId: updated!._id.toString(),
        status: updated!.status,
        acceptedByReceptionistId: updated!.acceptedByReceptionistId?.toString(),
        acceptedAt: updated!.acceptedAt,
      },
    };
  }

  /**
   * Return an accepted task to the pool. Only the receptionist who accepted it
   * may release it; the conditional update enforces ownership + status atomically.
   */
  async releaseTask(taskId: string, receptionistId: string, reason?: string): Promise<DataResponse> {
    this.assertValidId(taskId);

    const task = await this.taskModel.findById(taskId).select('status acceptedByReceptionistId').lean();
    if (!task) {
      this.throwBlocked('TASK_NOT_FOUND', 'Assignment task not found', true);
    }
    if (task!.status !== AssignmentTaskStatus.ASSIGNED) {
      this.throwBlocked(
        'TASK_NOT_ASSIGNED',
        `Assignment task is not in an assigned state (current status: ${task!.status})`,
      );
    }
    if (task!.acceptedByReceptionistId?.toString() !== receptionistId) {
      this.throwBlocked('TASK_NOT_OWNED', 'Only the receptionist who accepted this task can release it');
    }

    const now = Date.now();
    const updated = await this.taskModel.findOneAndUpdate(
      {
        _id: taskId,
        status: AssignmentTaskStatus.ASSIGNED,
        acceptedByReceptionistId: this.toReceptionistId(receptionistId),
      },
      {
        $set: { status: AssignmentTaskStatus.PENDING },
        $unset: { acceptedByReceptionistId: '', acceptedAt: '' },
        $push: {
          history: this.historyEntry(
            now,
            AssignmentTaskStatus.ASSIGNED,
            AssignmentTaskStatus.PENDING,
            receptionistId,
            reason ? `released: ${reason}` : 'released',
          ),
        },
      },
      { new: true },
    );

    if (!updated) {
      // Lost a race with another transition (e.g. concurrent release/complete).
      this.throwBlocked('TASK_NOT_ASSIGNED', 'Assignment task is no longer assigned');
    }

    this.logger.log(`[Assignment] task=${taskId} released by receptionist=${receptionistId}`);

    return {
      code: ResponseCode.SUCCESS,
      message: 'Assignment task released',
      data: {
        taskId: updated!._id.toString(),
        status: updated!.status,
      },
    };
  }

  /**
   * Convert a broad (unassigned) appointment into a normal doctor-assigned one.
   * This is NOT reschedule: it sets the doctor/slot for the first time and then emits
   * appointment.booking.success so the existing VisitBookingListener creates Visit(CREATED).
   * Only the receptionist who accepted the task may assign it.
   */
  async assignDoctorAndSlot(
    taskId: string,
    receptionistId: string,
    input: AssignDoctorSlotInput,
  ): Promise<DataResponse> {
    this.assertValidId(taskId);
    // Task-level lock: only one receptionist may process a given task at a time. The
    // ownership check + slot lock + transactional re-checks inside remain the DB-level guards.
    return this.withTaskLock(taskId, receptionistId, () =>
      this.assignDoctorAndSlotInternal(taskId, receptionistId, input),
    );
  }

  private async assignDoctorAndSlotInternal(
    taskId: string,
    receptionistId: string,
    input: AssignDoctorSlotInput,
  ): Promise<DataResponse> {
    // --- 1. Load + validate task (ownership/state) ---
    const task = await this.taskModel
      .findById(taskId)
      .select('status acceptedByReceptionistId appointmentId')
      .lean();
    if (!task) {
      this.throwBlocked('TASK_NOT_FOUND', 'Assignment task not found', true);
    }
    if (task!.status !== AssignmentTaskStatus.ASSIGNED) {
      this.throwBlocked('TASK_NOT_ASSIGNED', `Assignment task is not in an assigned state (current status: ${task!.status})`);
    }
    if (task!.acceptedByReceptionistId?.toString() !== receptionistId) {
      this.throwBlocked('TASK_NOT_OWNED', 'Only the receptionist who accepted this task can assign it');
    }

    // --- 2. Load + validate appointment is still a broad, assignable appointment ---
    const appointment = await this.appointmentModel.findById(task!.appointmentId);
    if (!appointment) {
      this.throwBlocked('APPOINTMENT_NOT_ASSIGNABLE', 'Appointment not found for this task');
    }
    this.assertAppointmentAssignable(appointment!);

    // --- 3. Deposit gate: DICH_VU broad bookings take the deposit upfront, so the
    // appointment must already be PAID before a doctor/slot is committed. ---
    if (
      appointment!.paymentCategory === PaymentCategory.DICH_VU &&
      appointment!.depositStatus !== DepositStatus.PAID
    ) {
      this.throwBlocked('DEPOSIT_NOT_PAID', 'Deposit must be paid before assigning a doctor for this appointment');
    }

    // --- 4. Resolve + validate target slot ---
    const slot = await this.timeSlotLogModel.findById(input.timeSlotId).select('start end status').lean();
    if (!slot) {
      this.throwBlocked('SLOT_UNAVAILABLE', 'Selected time slot was not found');
    }

    const normalizedDate = TimeHelper.parseISOToUTC(input.appointmentDate);
    const window = AppointmentTimeHelper.resolveTimeWindow(normalizedDate, {
      start: (slot as any).start,
      end: (slot as any).end,
    });
    if (window.scheduledAt <= Date.now()) {
      this.throwBlocked('INVALID_SCHEDULE', 'Cannot assign a slot in the past');
    }

    // --- 5. Slot must belong to the chosen doctor (via Shift.timeSlots[]) ---
    const shiftOwner = await this.shiftModel
      .findOne({ doctorId: new Types.ObjectId(input.doctorId), timeSlots: new Types.ObjectId(input.timeSlotId) })
      .select('_id')
      .lean();
    if (!shiftOwner) {
      this.throwBlocked('SLOT_DOCTOR_MISMATCH', 'The selected slot does not belong to the selected doctor');
    }

    // --- 6. Acquire Redis slot lock before the transaction ---
    const lockKey = this.getSlotLockKey(input.doctorId, input.timeSlotId);
    const lockValue = `assign:${taskId}`;
    const lockAcquired = await this.redisService.acquireSlotLock(lockKey, lockValue, BOOKING_PENDING_TTL_SECONDS);
    if (!lockAcquired) {
      this.throwBlocked('SLOT_UNAVAILABLE', 'Slot is currently held by another booking');
    }

    const session = await this.appointmentModel.db.startSession();
    let assignedAppointment: AppointmentDocument | null = null;
    try {
      await session.withTransaction(async () => {
        // Re-check task ownership/state atomically.
        const freshTask = await this.taskModel.findById(taskId).session(session);
        if (
          !freshTask ||
          freshTask.status !== AssignmentTaskStatus.ASSIGNED ||
          freshTask.acceptedByReceptionistId?.toString() !== receptionistId
        ) {
          throw new Error('TASK_NOT_ASSIGNED');
        }

        // Re-check appointment still assignable.
        const freshAppt = await this.appointmentModel.findById(task!.appointmentId).session(session);
        if (!freshAppt || !this.isAppointmentAssignable(freshAppt)) {
          throw new Error('APPOINTMENT_NOT_ASSIGNABLE');
        }

        // Conflict check: another active appointment already holds this doctor/slot.
        const conflict = await this.appointmentModel
          .findOne({
            _id: { $ne: freshAppt._id },
            doctorId: new Types.ObjectId(input.doctorId),
            timeSlot: new Types.ObjectId(input.timeSlotId),
            appointmentStatus: { $in: [AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED] },
            $or: [{ scheduledAt: window.scheduledAt }, { date: window.scheduledAt }],
          })
          .session(session)
          .select('_id')
          .lean();
        if (conflict) {
          throw new Error('SLOT_ALREADY_BOOKED');
        }

        freshAppt.doctorId = new Types.ObjectId(input.doctorId);
        freshAppt.timeSlot = new Types.ObjectId(input.timeSlotId);
        freshAppt.date = window.scheduledAt;
        freshAppt.scheduledAt = window.scheduledAt;
        freshAppt.startTime = window.startTime;
        freshAppt.endTime = window.endTime;
        freshAppt.assignmentStatus = AssignmentStatus.ASSIGNED;
        await freshAppt.save({ session });

        await this.timeSlotLogModel.updateOne(
          { _id: new Types.ObjectId(input.timeSlotId) },
          { $set: { status: 'booked' } },
          { session },
        );

        const now = Date.now();
        freshTask.status = AssignmentTaskStatus.COMPLETED;
        freshTask.completedAt = now;
        freshTask.history.push({
          at: now,
          from: AssignmentTaskStatus.ASSIGNED,
          to: AssignmentTaskStatus.COMPLETED,
          by: receptionistId,
          note: 'doctor/slot assigned',
        });
        await freshTask.save({ session });

        assignedAppointment = freshAppt;
      });
    } catch (error: any) {
      if (error?.message === 'SLOT_ALREADY_BOOKED' || error?.code === 11000) {
        this.throwBlocked('SLOT_UNAVAILABLE', 'Slot already booked');
      }
      if (error?.message === 'APPOINTMENT_NOT_ASSIGNABLE') {
        this.throwBlocked('APPOINTMENT_NOT_ASSIGNABLE', 'Appointment is no longer assignable');
      }
      if (error?.message === 'TASK_NOT_ASSIGNED') {
        this.throwBlocked('TASK_NOT_ASSIGNED', 'Assignment task is no longer assigned to you');
      }
      this.logger.error(`assignDoctorAndSlot failed: ${error?.message || String(error)}`);
      throw error;
    } finally {
      await session.endSession();
      await this.redisService.releaseSlotLock(lockKey, lockValue);
    }

    const finalAppt = assignedAppointment as unknown as AppointmentDocument;
    const appointmentId = finalAppt._id.toString();

    // Emit booking.success so the existing listener creates Visit(CREATED) by re-reading
    // the now doctor-assigned appointment. Visit is NOT created directly here.
    const payload = await this.buildBookingSuccessPayload(finalAppt);
    this.eventEmitter.emit('appointment.booking.success', payload);

    this.eventEmitter.emit('appointment.assignment.completed', {
      taskId,
      appointmentId,
      doctorId: input.doctorId,
      timeSlotId: input.timeSlotId,
      scheduledAt: window.scheduledAt,
      patientEmail: finalAppt.patientEmail,
    });

    this.logger.log(`[Assignment] task=${taskId} assigned doctor=${input.doctorId} slot=${input.timeSlotId}`);

    return {
      code: ResponseCode.SUCCESS,
      message: 'Doctor and slot assigned',
      data: {
        appointmentId,
        doctorId: input.doctorId,
        timeSlotId: input.timeSlotId,
        scheduledAt: window.scheduledAt,
        status: finalAppt.appointmentStatus,
      },
    };
  }

  // ---- helpers --------------------------------------------------------------

  private isAppointmentAssignable(appointment: AppointmentDocument): boolean {
    return (
      !appointment.doctorId &&
      !appointment.timeSlot &&
      appointment.appointmentStatus === AppointmentStatus.PENDING
    );
  }

  private assertAppointmentAssignable(appointment: AppointmentDocument): void {
    if (appointment.doctorId || appointment.timeSlot) {
      this.throwBlocked('APPOINTMENT_NOT_ASSIGNABLE', 'Appointment already has a doctor/slot assigned');
    }
    if (appointment.appointmentStatus !== AppointmentStatus.PENDING) {
      this.throwBlocked(
        'APPOINTMENT_NOT_ASSIGNABLE',
        `Appointment is not assignable (status: ${appointment.appointmentStatus})`,
      );
    }
  }

  private async buildBookingSuccessPayload(appointment: AppointmentDocument) {
    const doctor = appointment.doctorId
      ? await this.doctorModel.findById(appointment.doctorId).populate('profileId', 'name email').lean()
      : null;
    const patient = appointment.patientId
      ? await this.patientModel
          .findById(appointment.patientId)
          .populate('profileId', 'name email phone avatarUrl')
          .lean()
      : null;

    const doctorProfile = (doctor as any)?.profileId ?? null;
    const patientProfile = (patient as any)?.profileId ?? null;

    const enriched = buildEnrichedAppointmentPayload(
      appointment,
      doctorProfile,
      patientProfile,
      appointment.consultationFee ?? 0,
      patientProfile?.name ?? appointment.patientEmail,
      appointment.patientEmail,
    );

    return { ...enriched, paymentStatus: PaymentStatusEnum.COMPLETED };
  }

  private getSlotLockKey(doctorId: string, timeSlotId: string): string {
    return `slot:${doctorId}:${timeSlotId}`;
  }

  private getTaskLockKey(taskId: string): string {
    return `assignment-task:${taskId}:lock`;
  }

  /**
   * Run `work` while holding a Redis lock on the task. Mirrors the booking flow's lock style
   * (`SET NX EX` via RedisService + compare-and-delete release). The lock value identifies the
   * owning receptionist so the release only deletes our own lock, never another request's.
   * A held lock surfaces a clear TASK_LOCK_HELD conflict instead of crashing.
   */
  private async withTaskLock<T>(
    taskId: string,
    receptionistId: string,
    work: () => Promise<T>,
  ): Promise<T> {
    const lockKey = this.getTaskLockKey(taskId);
    const lockValue = `receptionist:${receptionistId}`;
    const acquired = await this.redisService.acquireLock(
      lockKey,
      lockValue,
      this.TASK_LOCK_TTL_SECONDS,
    );
    if (!acquired) {
      this.throwBlocked(
        'TASK_LOCK_HELD',
        'This assignment task is currently being handled by another receptionist.',
      );
    }

    try {
      return await work();
    } finally {
      // Compare-and-delete: releases only if we still own the lock (safe on success/failure).
      await this.redisService.releaseLock(lockKey, lockValue);
    }
  }


  private async findByIdOrThrow(taskId: string): Promise<AppointmentAssignmentTaskDocument> {
    this.assertValidId(taskId);
    const task = await this.taskModel.findById(taskId).lean();
    if (!task) {
      this.throwBlocked('TASK_NOT_FOUND', 'Assignment task not found', true);
    }
    return task as AppointmentAssignmentTaskDocument;
  }

  private assertValidId(taskId: string): void {
    if (!Types.ObjectId.isValid(taskId)) {
      this.throwBlocked('TASK_NOT_FOUND', 'Assignment task not found', true);
    }
  }

  private toReceptionistId(receptionistId: string): Types.ObjectId {
    // Receptionists are accounts; accountId is a valid ObjectId.
    return new Types.ObjectId(receptionistId);
  }

  private historyEntry(
    at: number,
    from: AssignmentTaskStatus,
    to: AssignmentTaskStatus,
    by?: string,
    note?: string,
  ): AssignmentTaskHistoryEntry {
    return { at, from, to, by, note };
  }

  // Mirrors throwBlocked in the reschedule/cancel services for a consistent envelope.
  private throwBlocked(blockedReason: string, message: string, notFound = false): never {
    const payload = { code: ResponseCode.ERROR, message, data: { blockedReason } };
    if (notFound) {
      throw new NotFoundException(payload);
    }
    throw new BadRequestException(payload);
  }
}
