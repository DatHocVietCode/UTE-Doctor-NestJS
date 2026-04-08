import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { DataResponse } from 'src/common/dto/data-respone';
import { ResponseCode } from 'src/common/enum/reponse-code.enum';
import { RedisService } from 'src/common/redis/redis.service';
import { Doctor, DoctorDocument } from 'src/doctor/schema/doctor.schema';
import { Patient, PatientDocument } from 'src/patient/schema/patient.schema';
import { PaymentMethodEnum } from 'src/payment/enums/payment-method.enum';
import { PaymentStatusEnum } from 'src/payment/enums/payment-status.enum';
import { PaymentService } from 'src/payment/payment.service';
import { TimeSlotLog, TimeSlotLogDocument } from 'src/timeslot/schemas/timeslot-log.schema';
import { DateTimeHelper } from 'src/utils/helpers/datetime.helper';
import { WalletService } from 'src/wallet/wallet.service';
import { AppointmentBookingDto } from './dto/appointment-booking.dto';
import { AppointmentStatus } from './enums/Appointment-status.enum';
import { buildEnrichedAppointmentPayload } from './schemas/appointment-enriched';
import { Appointment, AppointmentDocument } from './schemas/appointment.schema';

@Injectable()
export class AppointmentBookingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AppointmentBookingService.name);
  private cleanupTimer?: NodeJS.Timeout;

  constructor(
    private readonly eventEmitter: EventEmitter2,
    private readonly paymentService: PaymentService,
    private readonly redisService: RedisService,
    private readonly walletService: WalletService,
    @InjectModel(Appointment.name) private readonly appointmentModel: Model<Appointment>,
    @InjectModel(TimeSlotLog.name) private readonly timeSlotLogModel: Model<TimeSlotLogDocument>,
    @InjectModel(Patient.name) private readonly patientModel: Model<PatientDocument>,
    @InjectModel(Doctor.name) private readonly doctorModel: Model<DoctorDocument>,
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

    const lockAcquired = await this.redisService.acquireSlotLock(slotKey, lockValue, 300);
    
    if (!lockAcquired) {
      return {
        code: ResponseCode.ERROR,
        message: 'Slot already booked',
        data: null,
      };
    }

    const normalizedDate = DateTimeHelper.toUtcDate(bookingAppointment.date);
    const appointmentDoc = new this.appointmentModel({
      _id: bookingId,
      date: normalizedDate ?? bookingAppointment.date,
      appointmentStatus: AppointmentStatus.PENDING,
      serviceType: bookingAppointment.serviceType,
      consultationFee: bookingAppointment.amount ?? undefined,
      paymentAmount: bookingAppointment.amount ?? undefined,
      timeSlot: new Types.ObjectId(bookingAppointment.timeSlotId),
      patientId: new Types.ObjectId(bookingAppointment.patientId),
      doctorId: new Types.ObjectId(doctorId),
      reasonForAppointment: bookingAppointment.reasonForAppointment,
      specialtyId: bookingAppointment.specialty ? bookingAppointment.specialty : null,
      paymentMethod: bookingAppointment.paymentMethod,
      hospitalName: bookingAppointment.hospitalName,
      patientEmail: bookingAppointment.patientEmail,
    });

    try {
      await appointmentDoc.save();
      await this.markTimeSlotBooked(bookingAppointment.timeSlotId);
    } catch (error: any) {
      await this.redisService.releaseSlotLock(slotKey, lockValue);

      if (error?.code === 11000) {
        return {
          code: ResponseCode.ERROR,
          message: 'Slot already booked',
          data: null,
        };
      }

      throw error;
    }

    try {
      if (bookingAppointment.paymentMethod === PaymentMethodEnum.ONLINE) {
        const paymentUrl = this.paymentService.createPaymentUrl(
          appointmentDoc._id.toString(),
          bookingAppointment.amount ?? 0,
          clientIp,
        );

        const pendingPayload = await this.buildBookingPayload(appointmentDoc);
        pendingPayload.paymentStatus = PaymentStatusEnum.PENDING;
        this.eventEmitter.emit('appointment.booking.pending', pendingPayload);

        return {
          code: ResponseCode.PENDING,
          message: 'Appointment created. Complete payment to confirm booking.',
          data: {
            appointmentId: appointmentDoc._id.toString(),
            paymentUrl,
          },
        };
      }

      if (bookingAppointment.paymentMethod === PaymentMethodEnum.COIN) {
        const coinsToUse = bookingAppointment.coinsToUse ?? bookingAppointment.amount ?? 0;
        const paymentResult = await this.walletService.deductCoins(
          bookingAppointment.patientId,
          coinsToUse,
          'appointment_booking',
          appointmentDoc._id.toString(),
          `Thanh toán khám chữa bệnh bằng ${coinsToUse} coin`,
        );

        if (paymentResult.code !== ResponseCode.SUCCESS) {
          return await this.failBooking(
            appointmentDoc._id.toString(),
            paymentResult.message || 'Coin payment failed',
            lockValue,
            slotKey,
          );
        }

        return await this.confirmBooking(appointmentDoc._id.toString(), lockValue, slotKey, paymentResult.message);
      }

      return await this.failBooking(
        appointmentDoc._id.toString(),
        'Offline payment is not supported',
        lockValue,
        slotKey,
      );
    } catch (error: any) {
      return await this.failBooking(
        appointmentDoc._id.toString(),
        error?.message || 'Booking failed',
        lockValue,
        slotKey,
      );
    }
  }

  async handleVnpayReturn(orderId: string, success: boolean, reason?: string): Promise<DataResponse> {
    if (success) {
      return this.confirmBooking(orderId, undefined, undefined, reason);
    }

    return this.failBooking(orderId, reason || 'Payment failed', undefined, undefined);
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
      });
    }

    return this.failBooking(input.orderId, input.reason || 'Payment failed', undefined, undefined, {
      amount: input.amount,
      paidAt: input.paidAt,
      responseCode: input.responseCode,
      transactionStatus: input.transactionStatus,
    });
  }

  private async confirmBooking(
    orderId: string,
    lockValue?: string,
    slotKey?: string,
    note?: string,
    paymentMeta?: { amount?: number; paidAt?: Date | null; responseCode?: string; transactionStatus?: string },
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
        },
      };
    }

    if (appointment.appointmentStatus !== AppointmentStatus.PENDING) {
      return {
        code: ResponseCode.ERROR,
        message: `Appointment cannot be confirmed from status ${appointment.appointmentStatus}`,
        data: null,
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
      },
    };
  }

  private async failBooking(
    orderId: string,
    reason: string,
    lockValue?: string,
    slotKey?: string,
    paymentMeta?: { amount?: number; paidAt?: Date | null; responseCode?: string; transactionStatus?: string },
  ): Promise<DataResponse> {
    const appointment = await this.appointmentModel.findById(orderId);

    if (!appointment) {
      if (slotKey && lockValue) {
        await this.redisService.releaseSlotLock(slotKey, lockValue);
      }

      return {
        code: ResponseCode.NOT_FOUND,
        message: 'Appointment not found',
        data: null,
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
      },
    };
  }

  async expirePendingBookings(): Promise<void> {
    const expirationTime = new Date(Date.now() - 5 * 60 * 1000);
    const expiredAppointments = await this.appointmentModel
      .find({
        appointmentStatus: AppointmentStatus.PENDING,
        createdAt: { $lte: expirationTime },
      })
      .exec();

    for (const appointment of expiredAppointments) {
      this.logger.log(`Expiring pending booking ${appointment._id.toString()}`);
      await this.failBooking(appointment._id.toString(), 'Appointment expired after 5 minutes');
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

  private async markTimeSlotBooked(timeSlotId: string) {
    await this.timeSlotLogModel.updateOne(
      { _id: new Types.ObjectId(timeSlotId) },
      { $set: { status: 'booked' } },
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