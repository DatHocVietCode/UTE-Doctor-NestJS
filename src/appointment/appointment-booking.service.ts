import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { DataResponse } from 'src/common/dto/data-respone';
import { ResponseCode } from 'src/common/enum/reponse-code.enum';
import { RedisService } from 'src/common/redis/redis.service';
import { Doctor, DoctorDocument } from 'src/doctor/schema/doctor.schema';
import { Patient, PatientDocument } from 'src/patient/schema/patient.schema';
import { PaymentMethodEnum } from 'src/payment/enums/payment-method.enum';
import { PaymentStatusEnum } from 'src/payment/enums/payment-status.enum';
import { PaymentService } from 'src/payment/payment.service';
import { Payment } from 'src/payment/schemas/payment.schema';
import { BOOKING_PENDING_TTL_SECONDS, VNPAY_EXPIRE_MINUTES } from 'src/payment/vnpay/vnpay-timeout.config';
import { TimeSlotLog, TimeSlotLogDocument } from 'src/timeslot/schemas/timeslot-log.schema';
import { TimeHelper } from 'src/utils/helpers/time.helper';
import { CoinService } from 'src/wallet/coin/coin.service';
import { CreditService } from 'src/wallet/credit/credit.service';
import { AppointmentBookingDto } from './dto/appointment-booking.dto';
import { AppointmentStatus } from './enums/Appointment-status.enum';
import { AssignmentStatus } from './enums/assignment-status.enum';
import { AssignmentTaskStatus } from './enums/assignment-task-status.enum';
import { DepositStatus } from './enums/deposit-status.enum';
import { PaymentCategory } from './enums/payment-category.enum';
import { VisitType } from './enums/visit-type.enum';
import {
  AppointmentAssignmentTask,
  AppointmentAssignmentTaskDocument,
} from './schemas/appointment-assignment-task.schema';
import { buildEnrichedAppointmentPayload } from './schemas/appointment-enriched';
import { Appointment, AppointmentDocument } from './schemas/appointment.schema';
import { AppointmentTimeHelper } from './utils/appointment-time.helper';

// Default SLA window for a receptionist to pick up a broad-booking task.
const DEFAULT_ASSIGNMENT_DEADLINE_MINUTES = 30;

type BookingAmountBreakdown = {
  originalAmount: number;
  discountAmount: number;
  finalAmount: number;
};

@Injectable()
export class AppointmentBookingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AppointmentBookingService.name);
  private cleanupTimer?: NodeJS.Timeout;
  private readonly coinDiscountRate = 0.1;
  private readonly coinDiscountCap = 30000;

  constructor(
    private readonly eventEmitter: EventEmitter2,
    private readonly config: ConfigService,
    private readonly paymentService: PaymentService,
    private readonly redisService: RedisService,
    private readonly coinService: CoinService,
    private readonly creditService: CreditService,
    @InjectModel(Appointment.name) private readonly appointmentModel: Model<Appointment>,
    @InjectModel(TimeSlotLog.name) private readonly timeSlotLogModel: Model<TimeSlotLogDocument>,
    @InjectModel(Patient.name) private readonly patientModel: Model<PatientDocument>,
    @InjectModel(Doctor.name) private readonly doctorModel: Model<DoctorDocument>,
    @InjectModel(Payment.name) private readonly paymentModel: Model<Payment>,
    @InjectModel(AppointmentAssignmentTask.name)
    private readonly assignmentTaskModel: Model<AppointmentAssignmentTaskDocument>,
  ) {}

  onModuleInit() {
    this.cleanupTimer = setInterval(() => {
      void this.expirePendingBookings();
    }, 60_000);
  }

  async onModuleDestroy() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
  }

  async bookAppointment(bookingAppointment: AppointmentBookingDto, clientIp = '127.0.0.1'): Promise<DataResponse> {
    // Normalize new visit-based fields before legacy validations/payment flow.
    bookingAppointment = this.normalizeVisitWorkflowDefaults(bookingAppointment);

    // Broad booking has no doctor/slot — branch out before the normal validation,
    // which hard-requires both. This keeps the normal booking path untouched.
    if (bookingAppointment.broadBooking) {
      return this.bookBroadAppointment(bookingAppointment, clientIp);
    }

    this.validateBookingRequest(bookingAppointment);

    const bookingId = new Types.ObjectId();
    const doctorId = bookingAppointment.doctor?.id as string;
    const slotKey = this.getSlotKey(doctorId, bookingAppointment.timeSlotId);
    const lockValue = bookingId.toString();
    let appointmentDateNormalized: Date;
    let appointmentDateEpoch: number;
    let bookingDateEpoch: number;
    let bookingAmounts = this.getDefaultAmountBreakdown(this.resolveConsultationFee());
    let resolvedTimeSlot: Pick<TimeSlotLog, 'start' | 'end'> | null = null;
    
    try {
      // Parse appointmentDate (required): Fallback to legacy 'date' field for backward compatibility.
      const appointmentDateRaw = bookingAppointment.appointmentDate ?? bookingAppointment.date;
      if (!appointmentDateRaw) {
        throw new BadRequestException('appointmentDate is required');
      }
      // Single parsing point: normalize the appointment date once to ensure consistency.
      appointmentDateNormalized = TimeHelper.parseISOToUTC(appointmentDateRaw);
      appointmentDateEpoch = TimeHelper.toEpoch(appointmentDateNormalized);

      // Parse bookingDate (optional): Default to current server time if not provided.
      if (bookingAppointment.bookingDate) {
        bookingDateEpoch = TimeHelper.toEpoch(TimeHelper.parseISOToUTC(bookingAppointment.bookingDate));
      } else {
        bookingDateEpoch = Date.now();
      }
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Invalid datetime input');
    }
    TimeHelper.debugLog('[TimeDebug]', {
      appointmentDateInput: bookingAppointment.appointmentDate || bookingAppointment.date,
      appointmentDateParsedUtc: appointmentDateNormalized.toISOString(),
      appointmentDateEpoch,
      bookingDateEpoch,
    });

    let lockAcquired = false;
    try {
      lockAcquired = await this.redisService.acquireSlotLock(
        slotKey,
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

      // Resolve the slot once so the appointment stores a stable snapshot.
      resolvedTimeSlot = await this.timeSlotLogModel
        .findById(bookingAppointment.timeSlotId)
        .select('start end')
        .lean() as Pick<TimeSlotLog, 'start' | 'end'> | null;

      if (!resolvedTimeSlot) {
        throw new NotFoundException('TimeSlot not found');
      }

      // Compute the persisted appointment snapshot from the chosen day + slot.
      // Use the already-normalized date to avoid double parsing.
      const timeWindow = AppointmentTimeHelper.resolveTimeWindow(appointmentDateNormalized, resolvedTimeSlot);

      const slotAvailable = await this.checkSlotAvailability(
        doctorId,
        bookingAppointment.timeSlotId,
        appointmentDateEpoch,
        timeWindow.scheduledAt,
      );
      if (!slotAvailable) {
        await this.safeReleaseSlotLock(slotKey, lockValue);
        return {
          code: ResponseCode.ERROR,
          message: 'Slot already booked',
          data: {
            ...bookingAmounts,
          },
        };
      }

      // Client-sent amount is deprecated; fee snapshots now come from server policy.
      bookingAmounts = this.getDefaultAmountBreakdown(this.resolveConsultationFee());

      const appointmentDoc = await this.createAppointmentWithTransaction({
        bookingId,
        bookingAppointment,
        doctorId,
        appointmentDateEpoch,
        bookingDateEpoch,
        scheduledAt: timeWindow.scheduledAt,
        startTime: timeWindow.startTime,
        endTime: timeWindow.endTime,
        originalAmount: bookingAmounts.originalAmount,
        discountAmount: bookingAmounts.discountAmount,
        finalAmount: bookingAmounts.finalAmount,
        lockValue,
        slotKey,
      });

      if (bookingAppointment.paymentCategory === PaymentCategory.DICH_VU) {
        let depositPayment: { paymentId: string; paymentUrl: string; amount: number; purpose: string };
        try {
          depositPayment = await this.paymentService.createDepositPaymentForAppointment(
            appointmentDoc._id.toString(),
            bookingAppointment.depositAmount ?? 0,
            clientIp,
          );
        } catch (error: any) {
          return await this.failBooking(
            appointmentDoc._id.toString(),
            error?.message || 'Deposit payment creation failed',
            lockValue,
            slotKey,
            undefined,
            bookingAmounts,
          );
        }

        const payload = await this.buildBookingPayload(appointmentDoc);
        this.eventEmitter.emit('appointment.booking.pending', payload);

        return {
          code: ResponseCode.PENDING,
          message: 'Appointment created. Complete deposit payment to confirm booking.',
          data: {
            appointmentId: appointmentDoc._id.toString(),
            depositStatus: DepositStatus.PENDING,
            depositAmount: bookingAppointment.depositAmount ?? 0,
            depositPaymentId: depositPayment.paymentId,
            paymentUrl: depositPayment.paymentUrl,
            ...bookingAmounts,
          },
        };
      }

      if (bookingAmounts.finalAmount === 0) {
        return await this.confirmBooking(
          appointmentDoc._id.toString(),
          lockValue,
          slotKey,
          'Appointment confirmed successfully',
          {
            amount: 0,
            paidAt: new Date(),
          },
          bookingAmounts,
        );
      }

      // BHYT has no deposit requirement; remaining payment is handled by billing.
      return await this.confirmBooking(
        appointmentDoc._id.toString(),
        lockValue,
        slotKey,
        'Booking confirmed (payment deferred - use billing flow)',
        undefined, // no payment meta persisted here
        bookingAmounts,
      );
    } catch (error: any) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      if (lockAcquired) {
        await this.safeReleaseSlotLock(slotKey, lockValue);
      }

      if (error?.code === 11000) {
        return {
          code: ResponseCode.ERROR,
          message: 'Slot already booked',
          data: {
            ...bookingAmounts,
          },
        };
      }

      this.logger.error(`bookAppointment failed: ${error?.message || String(error)}`);
      return {
        code: ResponseCode.ERROR,
        message: error?.message || 'Booking failed',
        data: {
          ...bookingAmounts,
        },
      };
    }
  }

  /**
   * Broad booking: create a PENDING appointment with no doctor/slot plus a PENDING
   * assignment task for receptionists. Does NOT emit appointment.booking.success and
   * does NOT create a Visit — those happen only once a doctor/slot is assigned.
   */
  private async bookBroadAppointment(
    bookingAppointment: AppointmentBookingDto,
    clientIp: string,
  ): Promise<DataResponse> {
    this.validateBroadBookingRequest(bookingAppointment);

    const bookingDateEpoch = bookingAppointment.bookingDate
      ? TimeHelper.toEpoch(TimeHelper.parseISOToUTC(bookingAppointment.bookingDate))
      : Date.now();

    const isDichVu = bookingAppointment.paymentCategory === PaymentCategory.DICH_VU;
    const consultationFee = this.resolveConsultationFee();
    const amounts = this.getDefaultAmountBreakdown(consultationFee);
    const deadlineAt = Date.now() + this.resolveAssignmentDeadlineMs();

    const bookingId = new Types.ObjectId();
    const session = await this.appointmentModel.db.startSession();
    let appointmentDoc: AppointmentDocument | null = null;
    let taskId: string | null = null;
    let committed = false;

    try {
      await session.withTransaction(async () => {
        const apptDocs = await this.appointmentModel.create(
          [
            {
              _id: bookingId,
              // No real schedule yet; placeholders satisfy the required fields and are
              // overwritten when a receptionist assigns a doctor/slot. The appointment is
              // distinguished as broad via assignmentStatus = AWAITING_ASSIGNMENT.
              date: bookingDateEpoch,
              scheduledAt: bookingDateEpoch,
              bookingDate: bookingDateEpoch,
              appointmentStatus: AppointmentStatus.PENDING,
              assignmentStatus: AssignmentStatus.AWAITING_ASSIGNMENT,
              serviceType: bookingAppointment.serviceType,
              consultationFee: amounts.originalAmount,
              paymentCategory: bookingAppointment.paymentCategory,
              depositAmount: isDichVu ? bookingAppointment.depositAmount ?? 0 : 0,
              depositStatus: isDichVu ? DepositStatus.PENDING : DepositStatus.NOT_REQUIRED,
              depositPaidAmount: 0,
              coinDiscountAmount: amounts.discountAmount,
              paymentAmount: amounts.finalAmount,
              // doctorId and timeSlot intentionally omitted (null) until assignment.
              patientId: new Types.ObjectId(bookingAppointment.patientId),
              reasonForAppointment: bookingAppointment.reasonForAppointment,
              specialtyId: bookingAppointment.specialty ?? null,
              paymentMethod: bookingAppointment.paymentMethod,
              hospitalName: bookingAppointment.hospitalName,
              patientEmail: bookingAppointment.patientEmail,
            },
          ],
          { session },
        );
        appointmentDoc = apptDocs[0] as AppointmentDocument;

        const now = Date.now();
        const taskDocs = await this.assignmentTaskModel.create(
          [
            {
              appointmentId: appointmentDoc._id,
              status: AssignmentTaskStatus.PENDING,
              deadlineAt,
              specialty: bookingAppointment.specialty,
              reasonForAppointment: bookingAppointment.reasonForAppointment,
              patientEmail: bookingAppointment.patientEmail,
              priority: 'NORMAL',
              history: [
                {
                  at: now,
                  from: '',
                  to: AssignmentTaskStatus.PENDING,
                  by: 'system',
                  note: 'broad booking created',
                },
              ],
            },
          ],
          { session },
        );
        taskId = taskDocs[0]._id.toString();
      });
      committed = true;
    } catch (error: any) {
      this.logger.error(`bookBroadAppointment failed: ${error?.message || String(error)}`);
    } finally {
      await session.endSession();
    }

    // Both appointment and task are created atomically; treat as failure unless the
    // transaction committed. (The unique partial index on appointmentId still guards
    // against duplicate active tasks should the same appointment ever be retried.)
    if (!committed || !appointmentDoc || !taskId) {
      return {
        code: ResponseCode.ERROR,
        message: 'Broad booking failed',
        data: { ...amounts },
      };
    }

    const appointment = appointmentDoc as AppointmentDocument;
    const appointmentId = appointment._id.toString();

    // DICH_VU broad booking takes the deposit upfront (same as normal DICH_VU), so the
    // queue only holds paying patients. Failure marks the appointment FAILED + task CANCELLED.
    let depositInfo: { depositPaymentId?: string; paymentUrl?: string } = {};
    if (isDichVu) {
      try {
        const depositPayment = await this.paymentService.createDepositPaymentForAppointment(
          appointmentId,
          bookingAppointment.depositAmount ?? 0,
          clientIp,
        );
        depositInfo = {
          depositPaymentId: depositPayment.paymentId,
          paymentUrl: depositPayment.paymentUrl,
        };
      } catch (error: any) {
        await this.cancelBroadBookingAfterDepositFailure(appointmentId, taskId!);
        return {
          code: ResponseCode.ERROR,
          message: error?.message || 'Deposit payment creation failed',
          data: { appointmentId, ...amounts },
        };
      }
    }

    // Notify the assignment pipeline. Visit creation is deliberately deferred.
    this.eventEmitter.emit('appointment.assignment.created', {
      taskId,
      appointmentId,
      patientEmail: bookingAppointment.patientEmail,
      specialty: bookingAppointment.specialty,
      priority: 'NORMAL',
      deadlineAt,
      reasonForAppointment: bookingAppointment.reasonForAppointment,
    });

    return {
      code: ResponseCode.PENDING,
      message: isDichVu
        ? 'Broad appointment created. Complete deposit payment; a receptionist will assign a doctor.'
        : 'Broad appointment created. A receptionist will assign a doctor.',
      data: {
        appointmentId,
        assignmentTaskId: taskId,
        assignmentStatus: AssignmentStatus.AWAITING_ASSIGNMENT,
        depositStatus: isDichVu ? DepositStatus.PENDING : DepositStatus.NOT_REQUIRED,
        depositAmount: isDichVu ? bookingAppointment.depositAmount ?? 0 : 0,
        ...depositInfo,
        ...amounts,
      },
    };
  }

  private validateBroadBookingRequest(dto: AppointmentBookingDto) {
    if (!dto.patientEmail || !dto.patientId) {
      throw new BadRequestException('Patient context is required');
    }

    // At least one routing hint is required so a receptionist can triage the request.
    if (!dto.specialty && !dto.reasonForAppointment) {
      throw new BadRequestException('Either specialty or reasonForAppointment is required for broad booking');
    }

    if (dto.paymentMethod === PaymentMethodEnum.COIN) {
      throw new BadRequestException('COIN payment method is deprecated. Use useCoin=true for discount with ONLINE/VNPAY/CREDIT');
    }

    // DICH_VU still requires an upfront deposit, mirroring the normal booking rule.
    if (dto.paymentCategory === PaymentCategory.DICH_VU && (!dto.depositAmount || dto.depositAmount <= 0)) {
      throw new BadRequestException('depositAmount must be greater than 0 for DICH_VU bookings');
    }
  }

  private resolveAssignmentDeadlineMs(): number {
    const configured = Number(this.config.get('ASSIGNMENT_DEADLINE_MINUTES'));
    const minutes =
      Number.isFinite(configured) && configured > 0
        ? Math.floor(configured)
        : DEFAULT_ASSIGNMENT_DEADLINE_MINUTES;
    return minutes * 60_000;
  }

  private async cancelBroadBookingAfterDepositFailure(appointmentId: string, taskId: string) {
    try {
      await this.appointmentModel.updateOne(
        { _id: new Types.ObjectId(appointmentId) },
        { $set: { appointmentStatus: AppointmentStatus.FAILED, depositStatus: DepositStatus.FAILED } },
      );
      const now = Date.now();
      await this.assignmentTaskModel.updateOne(
        { _id: new Types.ObjectId(taskId), status: AssignmentTaskStatus.PENDING },
        {
          $set: { status: AssignmentTaskStatus.CANCELLED },
          $push: {
            history: {
              at: now,
              from: AssignmentTaskStatus.PENDING,
              to: AssignmentTaskStatus.CANCELLED,
              by: 'system',
              note: 'deposit payment creation failed',
            },
          },
        },
      );
    } catch (error: any) {
      this.logger.warn(
        `Failed to roll back broad booking ${appointmentId}/${taskId}: ${error?.message || String(error)}`,
      );
    }
  }

  private async checkSlotAvailability(
    doctorId: string,
    timeSlotId: string,
    bookingDateEpoch: number,
    scheduledAtEpoch: number,
  ): Promise<boolean> {
    // Check both snapshot and legacy date fields until the migration is complete.
    const existingAppointment = await this.appointmentModel.findOne({
      doctorId: new Types.ObjectId(doctorId),
      timeSlot: new Types.ObjectId(timeSlotId),
      appointmentStatus: { $in: [AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED] },
      $or: [
        { scheduledAt: scheduledAtEpoch },
        { date: scheduledAtEpoch },
        { date: bookingDateEpoch },
      ],
    }).select('_id').lean();

    return !existingAppointment;
  }

  private async createAppointmentWithTransaction(input: {
    bookingId: Types.ObjectId;
    bookingAppointment: AppointmentBookingDto;
    doctorId: string;
    appointmentDateEpoch: number;
    bookingDateEpoch: number;
    scheduledAt: number;
    startTime: number;
    endTime: number;
    originalAmount: number;
    discountAmount: number;
    finalAmount: number;
    lockValue: string;
    slotKey: string;
  }): Promise<AppointmentDocument> {
    const session = await this.appointmentModel.db.startSession();

    try {
      let savedAppointment: AppointmentDocument | null = null;

      await session.withTransaction(async () => {
        const slotAvailable = await this.checkSlotAvailability(
          input.doctorId,
          input.bookingAppointment.timeSlotId,
          input.appointmentDateEpoch,
          input.scheduledAt,
        );

        if (!slotAvailable) {
          throw this.buildSlotBookedError();
        }

        const docs = await this.appointmentModel.create([
          {
            // Persist the snapshot fields so later reads do not need shift/timeSlot reconstruction.
            _id: input.bookingId,
            date: input.scheduledAt,
            scheduledAt: input.scheduledAt,
                        bookingDate: input.bookingDateEpoch,
            startTime: input.startTime,
            endTime: input.endTime,
            appointmentStatus: AppointmentStatus.PENDING,
            serviceType: input.bookingAppointment.serviceType,
                        consultationFee: input.originalAmount,
                        paymentCategory: input.bookingAppointment.paymentCategory,
                        depositAmount: input.bookingAppointment.depositAmount ?? 0,
                        depositStatus: input.bookingAppointment.paymentCategory === PaymentCategory.DICH_VU
                          ? DepositStatus.PENDING
                          : DepositStatus.NOT_REQUIRED,
                        depositPaidAmount: 0,
                        coinDiscountAmount: input.discountAmount,
                        paymentAmount: input.finalAmount,
            timeSlot: new Types.ObjectId(input.bookingAppointment.timeSlotId),
            patientId: new Types.ObjectId(input.bookingAppointment.patientId),
            doctorId: new Types.ObjectId(input.doctorId),
            reasonForAppointment: input.bookingAppointment.reasonForAppointment,
            specialtyId: input.bookingAppointment.specialty ? input.bookingAppointment.specialty : null,
            paymentMethod: input.bookingAppointment.paymentMethod,
            hospitalName: input.bookingAppointment.hospitalName,
            patientEmail: input.bookingAppointment.patientEmail,
          },
        ], { session });

        await this.markTimeSlotBooked(input.bookingAppointment.timeSlotId, session);
        savedAppointment = docs[0] as AppointmentDocument;
      });

      if (!savedAppointment) {
        throw new Error('Failed to create appointment');
      }

      return savedAppointment;
    } catch (error: any) {
      await this.safeReleaseSlotLock(input.slotKey, input.lockValue);

      if (error?.code === 11000 || error?.message === 'SLOT_ALREADY_BOOKED') {
        const duplicateError = new Error('Slot already booked') as Error & { code?: number };
        duplicateError.code = 11000;
        throw duplicateError;
      }

      throw error;
    } finally {
      await session.endSession();
    }
  }

  private async handleOnlinePayment(
    appointmentDoc: AppointmentDocument,
    bookingAppointment: AppointmentBookingDto,
    clientIp: string,
    lockValue: string,
    slotKey: string,
    amounts: BookingAmountBreakdown,
  ): Promise<DataResponse> {
    const appointmentId = appointmentDoc._id.toString();
    this.logger.warn('[Deprecated] handleOnlinePayment called for appointment ' + appointmentId);
    throw new BadRequestException('Payment after booking is deprecated. Use billing flow.');
  }

  private async handleCreditPayment(
    appointmentDoc: AppointmentDocument,
    bookingAppointment: AppointmentBookingDto,
    lockValue: string,
    slotKey: string,
    amounts: BookingAmountBreakdown,
  ): Promise<DataResponse> {
    const appointmentId = appointmentDoc._id.toString();
    this.logger.warn('[Deprecated] handleCreditPayment called for appointment ' + appointmentId);
    throw new BadRequestException('Payment after booking is deprecated. Use billing flow.');
  }

  private buildSlotBookedError() {
    return new Error('SLOT_ALREADY_BOOKED');
  }

  private async safeReleaseSlotLock(slotKey: string, lockValue: string) {
    try {
      await this.redisService.releaseSlotLock(slotKey, lockValue);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to release Redis lock ${slotKey}: ${errorMsg}`);
    }
  }

  async handleVnpayReturn(orderId: string, success: boolean, reason?: string): Promise<DataResponse> {
    if (success) {
      return this.confirmBooking(orderId, undefined, undefined, reason, undefined, undefined);
    }

    return this.failBooking(orderId, reason || 'Payment failed', undefined, undefined, undefined, undefined);
  }

  async getPaymentStatus(orderId: string): Promise<{
    orderId: string;
    status: PaymentStatusEnum;
    amount: number;
    paidAt: string | null;
  }> {
    const appointment = await this.appointmentModel.findById(orderId).lean();

    if (!appointment) {
      throw new NotFoundException('Appointment not found');
    }

    return {
      orderId: appointment._id.toString(),
      status: this.mapAppointmentStatusToPaymentStatus(appointment.appointmentStatus),
      amount: appointment.paymentAmount ?? appointment.consultationFee ?? 0,
      paidAt: appointment.paidAt ? new Date(appointment.paidAt).toISOString() : null,
    };
  }

  async handleVnpayCallbackResult(input: {
    orderId: string;
    success: boolean;
    reason?: string;
    amount?: number;
    paidAt?: Date | null;
    responseCode?: string;
    transactionStatus?: string;
  }): Promise<DataResponse> {
    if (input.success) {
      return this.confirmBooking(input.orderId, undefined, undefined, input.reason, {
        amount: input.amount,
        paidAt: input.paidAt,
        responseCode: input.responseCode,
        transactionStatus: input.transactionStatus,
      }, undefined);
    }

    return this.failBooking(input.orderId, input.reason || 'Payment failed', undefined, undefined, {
      amount: input.amount,
      paidAt: input.paidAt,
      responseCode: input.responseCode,
      transactionStatus: input.transactionStatus,
    }, undefined);
  }

  private async confirmBooking(
    orderId: string,
    lockValue?: string,
    slotKey?: string,
    note?: string,
    paymentMeta?: { amount?: number; paidAt?: Date | null; responseCode?: string; transactionStatus?: string },
    amounts?: BookingAmountBreakdown,
  ): Promise<DataResponse> {
    const appointment = await this.appointmentModel.findById(orderId);
    if (!appointment) {
      throw new NotFoundException('Appointment not found');
    }

    if (
      appointment.appointmentStatus === AppointmentStatus.CONFIRMED ||
      appointment.appointmentStatus === AppointmentStatus.COMPLETED
    ) {
      return {
        code: ResponseCode.SUCCESS,
        message: `Appointment already finalized as ${appointment.appointmentStatus}`,
        data: {
          appointmentId: appointment._id.toString(),
          depositStatus: appointment.depositStatus,
          depositAmount: appointment.depositAmount ?? 0,
          depositPaidAmount: appointment.depositPaidAmount ?? 0,
          depositPaidAt: appointment.depositPaidAt ?? null,
          ...(amounts ?? this.buildAmountBreakdownFromAppointment(appointment)),
        },
      };
    }

    if (appointment.appointmentStatus !== AppointmentStatus.PENDING) {
      return {
        code: ResponseCode.ERROR,
        message: `Appointment cannot be confirmed from status ${appointment.appointmentStatus}`,
        data: {
          appointmentId: appointment._id.toString(),
          depositStatus: appointment.depositStatus,
          depositAmount: appointment.depositAmount ?? 0,
          depositPaidAmount: appointment.depositPaidAmount ?? 0,
          depositPaidAt: appointment.depositPaidAt ?? null,
          ...(amounts ?? this.buildAmountBreakdownFromAppointment(appointment)),
        },
      };
    }

    appointment.appointmentStatus = AppointmentStatus.CONFIRMED;
    if (typeof paymentMeta?.amount === 'number') {
      appointment.paymentAmount = paymentMeta.amount;
    }
    if (paymentMeta?.paidAt) {
      appointment.paidAt = paymentMeta.paidAt;
    }
    if (paymentMeta?.responseCode) {
      appointment.paymentResponseCode = paymentMeta.responseCode;
    }
    if (paymentMeta?.transactionStatus) {
      appointment.paymentTransactionStatus = paymentMeta.transactionStatus;
    }
    await appointment.save();

    await this.releaseBookingLock(appointment, lockValue ?? appointment._id.toString());

    const payload = await this.buildBookingPayload(appointment);
    payload.paymentStatus = PaymentStatusEnum.COMPLETED;
    this.eventEmitter.emit('appointment.booking.success', payload);

    return {
      code: ResponseCode.SUCCESS,
      message: note || 'Appointment confirmed successfully',
      data: {
        appointmentId: appointment._id.toString(),
        depositStatus: appointment.depositStatus,
        depositAmount: appointment.depositAmount ?? 0,
        depositPaidAmount: appointment.depositPaidAmount ?? 0,
        depositPaidAt: appointment.depositPaidAt ?? null,
        ...(amounts ?? this.buildAmountBreakdownFromAppointment(appointment)),
      },
    };
  }

  private async failBooking(
    orderId: string,
    reason: string,
    lockValue?: string,
    slotKey?: string,
    paymentMeta?: { amount?: number; paidAt?: Date | null; responseCode?: string; transactionStatus?: string },
    amounts?: BookingAmountBreakdown,
  ): Promise<DataResponse> {
    const appointment = await this.appointmentModel.findById(orderId);

    if (!appointment) {
      if (slotKey && lockValue) {
        await this.redisService.releaseSlotLock(slotKey, lockValue);
      }

      return {
        code: ResponseCode.NOT_FOUND,
        message: 'Appointment not found',
        data: {
          ...(amounts ?? this.getDefaultAmountBreakdown(undefined)),
        },
      };
    }

    if (appointment.appointmentStatus === AppointmentStatus.FAILED) {
      if (slotKey && lockValue) {
        await this.redisService.releaseSlotLock(slotKey, lockValue);
      }

      return {
        code: ResponseCode.SUCCESS,
        message: reason,
        data: {
          appointmentId: appointment._id.toString(),
          ...(amounts ?? this.buildAmountBreakdownFromAppointment(appointment)),
        },
      };
    }

    if (
      appointment.appointmentStatus === AppointmentStatus.CONFIRMED ||
      appointment.appointmentStatus === AppointmentStatus.COMPLETED
    ) {
      return {
        code: ResponseCode.SUCCESS,
        message: `Appointment already finalized as ${appointment.appointmentStatus}`,
        data: {
          appointmentId: appointment._id.toString(),
          ...(amounts ?? this.buildAmountBreakdownFromAppointment(appointment)),
        },
      };
    }

    appointment.appointmentStatus = AppointmentStatus.FAILED;
    if (appointment.depositStatus === DepositStatus.PENDING) {
      appointment.depositStatus = DepositStatus.FAILED;
    }
    if (typeof paymentMeta?.amount === 'number') {
      appointment.paymentAmount = paymentMeta.amount;
    }
    if (paymentMeta?.paidAt) {
      appointment.paidAt = paymentMeta.paidAt;
    }
    if (paymentMeta?.responseCode) {
      appointment.paymentResponseCode = paymentMeta.responseCode;
    }
    if (paymentMeta?.transactionStatus) {
      appointment.paymentTransactionStatus = paymentMeta.transactionStatus;
    }
    await appointment.save();

    await this.releaseBookingLockAndReleaseSlot(appointment, lockValue ?? appointment._id.toString());

    this.eventEmitter.emit('appointment.booking.failed', {
      appointmentId: appointment._id.toString(),
      patientEmail: appointment.patientEmail,
      reason,
    });

    return {
      code: ResponseCode.ERROR,
      message: reason,
      data: {
        appointmentId: appointment._id.toString(),
        ...(amounts ?? this.buildAmountBreakdownFromAppointment(appointment)),
      },
    };
  }

  private resolveConsultationFee(): number {
    const configuredFee = Number(this.config.get('CONSULTATION_FEE'));
    return Number.isFinite(configuredFee) && !Number.isNaN(configuredFee)
      ? Math.max(0, Math.floor(configuredFee))
      : 0;
  }

  private getDefaultAmountBreakdown(amount?: number): BookingAmountBreakdown {
    const originalAmount = Math.max(0, Math.floor(amount ?? 0));
    return {
      originalAmount,
      discountAmount: 0,
      finalAmount: originalAmount,
    };
  }

  private buildAmountBreakdownFromAppointment(appointment: AppointmentDocument): BookingAmountBreakdown {
    const originalAmount = Math.max(0, Math.floor(appointment.consultationFee ?? 0));
    const discountAmount = Math.max(0, Math.floor((appointment as any).coinDiscountAmount ?? 0));
    const finalAmount = Math.max(0, Math.floor(appointment.paymentAmount ?? originalAmount - discountAmount));

    return {
      originalAmount,
      discountAmount,
      finalAmount,
    };
  }

  private async calculateBookingAmounts(bookingAppointment: AppointmentBookingDto): Promise<BookingAmountBreakdown> {
    const originalAmount = Math.max(0, Math.floor(bookingAppointment.amount ?? 0));
    if (!bookingAppointment.useCoin || originalAmount <= 0) {
      return {
        originalAmount,
        discountAmount: 0,
        finalAmount: originalAmount,
      };
    }

    const discount = await this.coinService.calculateDiscount(
      bookingAppointment.patientId,
      originalAmount,
      Boolean(bookingAppointment.useCoin),
      bookingAppointment.coinsToUse,
      this.coinDiscountRate,
      this.coinDiscountCap,
    );

    return {
      originalAmount,
      discountAmount: discount.discountAmount,
      finalAmount: Math.max(0, originalAmount - discount.discountAmount),
    };
  }

  async expirePendingBookings(): Promise<void> {
    const expirationTime = new Date(Date.now() - BOOKING_PENDING_TTL_SECONDS * 1000);
    const expiredAppointments = await this.appointmentModel
      .find({
        appointmentStatus: AppointmentStatus.PENDING,
        createdAt: { $lte: expirationTime },
        // Broad appointments await receptionist assignment; their lifecycle is governed by
        // the assignment task deadline, not the booking-payment TTL.
        assignmentStatus: { $ne: AssignmentStatus.AWAITING_ASSIGNMENT },
      })
      .exec();

    for (const appointment of expiredAppointments) {
      this.logger.log(`Expiring pending booking ${appointment._id.toString()}`);
      await this.failBooking(
        appointment._id.toString(),
        `Appointment expired after ${VNPAY_EXPIRE_MINUTES} minutes`,
      );
    }
  }

  private async buildBookingPayload(appointment: AppointmentDocument) {
    const doctor = appointment.doctorId
      ? await this.doctorModel.findById(appointment.doctorId).populate('profileId', 'name email').lean()
      : null;
    const patient = appointment.patientId
      ? await this.patientModel.findById(appointment.patientId).populate('profileId', 'name email phone avatarUrl').lean()
      : null;

    const doctorProfile = (doctor as any)?.profileId ? (doctor as any).profileId : null;
    const patientProfile = (patient as any)?.profileId ? (patient as any).profileId : null;

    const enriched = buildEnrichedAppointmentPayload(
      appointment,
      doctorProfile,
      patientProfile,
      appointment.consultationFee ?? 0,
      patientProfile?.name ?? appointment.patientEmail,
      appointment.patientEmail,
    );

    return {
      ...enriched,
      paymentStatus: PaymentStatusEnum.PENDING,
    };
  }

  private async markTimeSlotBooked(timeSlotId: string, session?: ClientSession) {
    await this.timeSlotLogModel.updateOne(
      { _id: new Types.ObjectId(timeSlotId) },
      { $set: { status: 'booked' } },
      { session },
    ).exec();
  }

  private async markTimeSlotAvailable(timeSlotId: string) {
    await this.timeSlotLogModel.updateOne(
      { _id: new Types.ObjectId(timeSlotId) },
      { $set: { status: 'available' } },
    ).exec();
  }

  private async releaseBookingLock(appointment: AppointmentDocument, lockValue?: string) {
    if (!appointment.doctorId || !appointment.timeSlot) {
      this.logger.warn(
        `Skip Redis lock release for appointment ${appointment._id?.toString?.()}: missing doctorId or timeSlot`,
      );
      return;
    }

    const slotKey = this.getSlotKey(appointment.doctorId.toString(), appointment.timeSlot.toString());
    await this.redisService.releaseSlotLock(slotKey, lockValue ?? appointment._id.toString());
  }

  private async releaseBookingLockAndReleaseSlot(
    appointment: AppointmentDocument,
    lockValue?: string,
  ) {
    await this.releaseBookingLock(appointment, lockValue);

    if (!appointment.timeSlot) {
      this.logger.warn(`Skip timeslot release for appointment ${appointment._id?.toString?.()}: missing timeSlot`);
      return;
    }

    await this.markTimeSlotAvailable(appointment.timeSlot.toString());
  }

  private getSlotKey(doctorId: string, timeSlotId: string) {
    return `slot:${doctorId}:${timeSlotId}`;
  }

  private validateBookingRequest(dto: AppointmentBookingDto) {
    if (!dto.doctor?.id) {
      throw new BadRequestException('Doctor is required');
    }

    if (!dto.timeSlotId) {
      throw new BadRequestException('Time slot is required');
    }

    if (!dto.hospitalName) {
      throw new BadRequestException('Hospital name is required');
    }

    if (!dto.serviceType) {
      throw new BadRequestException('Service type is required');
    }

    if (!dto.paymentMethod) {
      throw new BadRequestException('Payment method is required');
    }

    if (dto.paymentMethod === PaymentMethodEnum.COIN) {
      // Coin is no longer a standalone payment method; it is discount-only via useCoin flag.
      throw new BadRequestException('COIN payment method is deprecated. Use useCoin=true for discount with ONLINE/VNPAY/CREDIT');
    }

    if (dto.paymentCategory === PaymentCategory.DICH_VU && (!dto.depositAmount || dto.depositAmount <= 0)) {
      throw new BadRequestException('depositAmount must be greater than 0 for DICH_VU bookings');
    }

    if (!dto.patientEmail || !dto.patientId) {
      throw new BadRequestException('Patient context is required');
    }
  }

  private normalizeVisitWorkflowDefaults(dto: AppointmentBookingDto): AppointmentBookingDto {
    // Keep OFFLINE as safe default for the current visit-based rollout.
    const visitType = dto.visitType ?? VisitType.OFFLINE;
    let depositAmount = this.toSafeMoneyValue(dto.depositAmount);

    const paymentCategory = dto.paymentCategory ?? PaymentCategory.DICH_VU;

    if (paymentCategory === PaymentCategory.BHYT) {
      // BHYT visits never require deposit in the new workflow.
      depositAmount = 0;
    }

    if (paymentCategory === PaymentCategory.DICH_VU) {
      // DICH_VU allows deposit; preserve the provided value after sanitization.
      depositAmount = this.toSafeMoneyValue(dto.depositAmount);
    }

    return {
      ...dto,
      visitType,
      paymentCategory,
      depositAmount,
    };
  }

  private toSafeMoneyValue(value?: number): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return undefined;
    }

    return Math.max(0, Math.floor(value));
  }

  private mapAppointmentStatusToPaymentStatus(status: AppointmentStatus): PaymentStatusEnum {
    if (status === AppointmentStatus.CONFIRMED || status === AppointmentStatus.COMPLETED) {
      return PaymentStatusEnum.COMPLETED;
    }

    if (status === AppointmentStatus.FAILED || status === AppointmentStatus.CANCELLED) {
      return PaymentStatusEnum.FAILED;
    }

    return PaymentStatusEnum.PENDING;
  }
}
