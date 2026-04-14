import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
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
import { CoinService } from 'src/wallet/coin.service';
import { CreditService } from 'src/wallet/credit.service';
import { AppointmentBookingDto } from './dto/appointment-booking.dto';
import { AppointmentStatus } from './enums/Appointment-status.enum';
import { buildEnrichedAppointmentPayload } from './schemas/appointment-enriched';
import { Appointment, AppointmentDocument } from './schemas/appointment.schema';
import { AppointmentTimeHelper } from './utils/appointment-time.helper';

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
    private readonly paymentService: PaymentService,
    private readonly redisService: RedisService,
    private readonly coinService: CoinService,
    private readonly creditService: CreditService,
    @InjectModel(Appointment.name) private readonly appointmentModel: Model<Appointment>,
    @InjectModel(TimeSlotLog.name) private readonly timeSlotLogModel: Model<TimeSlotLogDocument>,
    @InjectModel(Patient.name) private readonly patientModel: Model<PatientDocument>,
    @InjectModel(Doctor.name) private readonly doctorModel: Model<DoctorDocument>,
    @InjectModel(Payment.name) private readonly paymentModel: Model<Payment>,
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
    this.validateBookingRequest(bookingAppointment);

    const bookingId = new Types.ObjectId();
    const doctorId = bookingAppointment.doctor?.id as string;
    const slotKey = this.getSlotKey(doctorId, bookingAppointment.timeSlotId);
    const lockValue = bookingId.toString();
    let appointmentDateNormalized: Date;
    let appointmentDateEpoch: number;
    let bookingDateEpoch: number;
    let bookingAmounts = this.getDefaultAmountBreakdown(bookingAppointment.amount);
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

      // Coins now act as discount-only; final payment is handled by ONLINE/VNPAY or CREDIT.
      bookingAmounts = await this.calculateBookingAmounts(bookingAppointment);

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

      if (bookingAmounts.discountAmount > 0) {
        const coinPaymentResult = await this.coinService.spendCoins(
          bookingAppointment.patientId,
          bookingAmounts.discountAmount,
          'appointment_booking_discount',
          appointmentDoc._id.toString(),
          `Apply ${bookingAmounts.discountAmount} coin discount for appointment booking`,
        );

        if (coinPaymentResult.code !== ResponseCode.SUCCESS) {
          return await this.failBooking(
            appointmentDoc._id.toString(),
            coinPaymentResult.message || 'Coin discount application failed',
            lockValue,
            slotKey,
            undefined,
            bookingAmounts,
          );
        }
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

      if (
        bookingAppointment.paymentMethod === PaymentMethodEnum.ONLINE ||
        bookingAppointment.paymentMethod === PaymentMethodEnum.VNPAY
      ) {
        return await this.handleOnlinePayment(
          appointmentDoc,
          bookingAppointment,
          clientIp,
          lockValue,
          slotKey,
          bookingAmounts,
        );
      }

      if (bookingAppointment.paymentMethod === PaymentMethodEnum.CREDIT) {
        return await this.handleCreditPayment(appointmentDoc, bookingAppointment, lockValue, slotKey, bookingAmounts);
      }

      return await this.failBooking(
        appointmentDoc._id.toString(),
        'Offline payment is not supported',
        lockValue,
        slotKey,
        undefined,
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
    const amount = amounts.finalAmount;

    try {
      const existingPayment = await this.paymentModel.findOne({
        appointmentId: appointmentDoc._id,
      }).select('_id').lean();

      if (existingPayment) {
        return {
          code: ResponseCode.ERROR,
          message: 'Payment already initiated for this appointment',
          data: {
            appointmentId,
            ...amounts,
          },
        };
      }

      await this.paymentModel.create({
        amount,
        method: PaymentMethodEnum.ONLINE,
        appointmentId: appointmentDoc._id,
        status: PaymentStatusEnum.PENDING,
      });

      const paymentUrl = this.paymentService.createPaymentUrl(appointmentId, amount, clientIp);

      const pendingPayload = await this.buildBookingPayload(appointmentDoc);
      pendingPayload.paymentStatus = PaymentStatusEnum.PENDING;
      this.eventEmitter.emit('appointment.booking.pending', pendingPayload);

      return {
        code: ResponseCode.PENDING,
        message: 'Appointment created. Complete payment to confirm booking.',
        data: {
          appointmentId,
          paymentUrl,
          ...amounts,
        },
      };
    } catch (error: any) {
      if (error?.code === 11000) {
        return {
          code: ResponseCode.ERROR,
          message: 'Payment already initiated for this appointment',
          data: {
            appointmentId,
            ...amounts,
          },
        };
      }

      return await this.failBooking(
        appointmentId,
        error?.message || 'Booking failed',
        lockValue,
        slotKey,
        undefined,
        amounts,
      );
    }
  }

  private async handleCreditPayment(
    appointmentDoc: AppointmentDocument,
    bookingAppointment: AppointmentBookingDto,
    lockValue: string,
    slotKey: string,
    amounts: BookingAmountBreakdown,
  ): Promise<DataResponse> {
    const paymentResult = await this.creditService.deductCredit(
      bookingAppointment.patientId,
      amounts.finalAmount,
      'appointment_booking',
      appointmentDoc._id.toString(),
      `Thanh toan lich kham bang credit: ${amounts.finalAmount}`,
    );

    if (paymentResult.code !== ResponseCode.SUCCESS) {
      return await this.failBooking(
        appointmentDoc._id.toString(),
        paymentResult.message || 'Credit payment failed',
        lockValue,
        slotKey,
        undefined,
        amounts,
      );
    }

    return await this.confirmBooking(
      appointmentDoc._id.toString(),
      lockValue,
      slotKey,
      paymentResult.message,
      {
        amount: amounts.finalAmount,
        paidAt: new Date(),
      },
      amounts,
    );
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
          ...(amounts ?? this.buildAmountBreakdownFromAppointment(appointment)),
        },
      };
    }

    if (appointment.appointmentStatus !== AppointmentStatus.PENDING) {
      return {
        code: ResponseCode.ERROR,
        message: `Appointment cannot be confirmed from status ${appointment.appointmentStatus}`,
        data: {
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

    if (
      (dto.paymentMethod === PaymentMethodEnum.ONLINE ||
        dto.paymentMethod === PaymentMethodEnum.VNPAY ||
        dto.paymentMethod === PaymentMethodEnum.CREDIT) &&
      (!dto.amount || dto.amount <= 0)
    ) {
      throw new BadRequestException('Amount must be greater than 0 for selected payment method');
    }

    if (!dto.patientEmail || !dto.patientId) {
      throw new BadRequestException('Patient context is required');
    }
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