import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from "@nestjs/event-emitter";
import { InjectModel } from "@nestjs/mongoose";
import mongoose, { Model, Types } from "mongoose";
import { Billing, BillingDocument } from "src/billing/billing.schema";
import { DataResponse } from "src/common/dto/data-respone";
import { ResponseCode } from "src/common/enum/reponse-code.enum";
import { RoleEnum } from 'src/common/enum/role.enum';
import { AuthUser } from "src/common/interfaces/auth-user";
import { Doctor, DoctorDocument } from "src/doctor/schema/doctor.schema";
import { MedicalEncounter, MedicalEncounterDocument } from "src/patient/schema/medical-record.schema";
import { Patient, PatientDocument } from "src/patient/schema/patient.schema";
import { Payment, PaymentDocument } from "src/payment/schemas/payment.schema";
import { PaymentFlowStatusEnum, PaymentPurposeEnum } from 'src/payment/enums/payment-flow.enum';
import { Profile, ProfileDocument } from "src/profile/schema/profile.schema";
import { TimeSlotLog, TimeSlotLogDocument } from "src/timeslot/schemas/timeslot-log.schema";
import { TimeHelper } from "src/utils/helpers/time.helper";
import { VisitStatus } from "src/visit/enums/visit-status.enum";
import { Visit, VisitDocument } from "src/visit/schemas/visit.schema";
import { VisitService } from 'src/visit/visit.service';
import { CoinService } from 'src/wallet/coin/coin.service';
import { CreditService } from 'src/wallet/credit/credit.service';
import { AppointmentBookingDto, CompleteAppointmentDto } from "./dto/appointment-booking.dto";
import { AppointmentDto } from "./dto/appointment.dto";
import { AppointmentStatus } from "./enums/Appointment-status.enum";
import { DepositStatus } from './enums/deposit-status.enum';
import { PaymentCategory } from './enums/payment-category.enum';
import { Appointment, AppointmentDocument } from "./schemas/appointment.schema";
import { AppointmentTimeHelper } from "./utils/appointment-time.helper";

@Injectable()
export class AppointmentService {

    constructor(private readonly eventEmitter: EventEmitter2,
        @InjectModel(Appointment.name) private readonly appointmentModel: Model<AppointmentDocument>,
        @InjectModel(TimeSlotLog.name) private readonly timeSlotLogModel: Model<TimeSlotLogDocument>,
        @InjectModel(Patient.name) private readonly patientModel: Model<PatientDocument>,
        @InjectModel(Doctor.name) private readonly doctorModel: Model<DoctorDocument>,
        @InjectModel(Profile.name) private readonly profileModel: Model<ProfileDocument>,
        @InjectModel(Visit.name) private readonly visitModel: Model<VisitDocument>,
        @InjectModel(MedicalEncounter.name) private readonly medicalEncounterModel: Model<MedicalEncounterDocument>,
        @InjectModel(Billing.name) private readonly billingModel: Model<BillingDocument>,
        @InjectModel(Payment.name) private readonly paymentModel: Model<PaymentDocument>,
        private readonly coinService: CoinService,
        private readonly visitService: VisitService,
        private readonly creditService: CreditService,
        private readonly config: ConfigService,
    ) {}

    async bookAppointment(bookingAppointment: AppointmentBookingDto) {
        // emit event
        this.eventEmitter.emit('appointment.booked', bookingAppointment);

        const dataResponse : DataResponse = {
            code: ResponseCode.PENDING,
            message: 'Appointment booking is being processed',
            data: null
        }
        return dataResponse;
    }

    async getAppointmentById(appointmentId: string) : Promise<AppointmentDocument | null> {
        const appointment = await this.appointmentModel.findById(appointmentId);
        console.log('Fetched appointment by ID:', appointmentId, appointment);
        return appointment;
    }

    async storeBookingInformation(payload: AppointmentBookingDto): Promise<AppointmentDocument> {
        // Parse appointmentDate (required): Fallback to legacy 'date' field for backward compatibility.
        const appointmentDateRaw = payload.appointmentDate ?? payload.date;
        if (!appointmentDateRaw) {
            throw new BadRequestException('appointmentDate is required');
        }

        const appointmentDateNormalized = TimeHelper.toEpoch(TimeHelper.parseISOToUTC(appointmentDateRaw));

        // Parse bookingDate (optional): Default to current server time if not provided.
        const bookingDateEpoch = payload.bookingDate
            ? TimeHelper.toEpoch(TimeHelper.parseISOToUTC(payload.bookingDate))
            : Date.now();

        const appointmentDoc = new this.appointmentModel({
            // Keep the legacy date field in sync while the new snapshot fields are rolled out.
            date: appointmentDateNormalized,
            scheduledAt: appointmentDateNormalized,
                        bookingDate: bookingDateEpoch,
            startTime: appointmentDateNormalized,
            endTime: appointmentDateNormalized,
            appointmentStatus: AppointmentStatus.PENDING, // default
            serviceType: payload.serviceType,
            consultationFee: payload.amount ?? undefined, // nếu amount có thì lưu
            timeSlot: payload.timeSlotId,
            patientId: payload.patientId, // This is account Id, not patient Id (To be fixed later)
            doctorId: payload.doctor?.id ?? undefined, // nếu null thì bỏ qua
            reasonForAppointment: payload.reasonForAppointment,
            specialtyId: payload.specialty ? payload.specialty : null,
            paymentMethod: payload.paymentMethod,
            hospitalName: payload.hospitalName,
            patientEmail: payload.patientEmail,
        });

        console.log('Storing appointment booking information:', appointmentDoc);
        const saved = await appointmentDoc.save();
        return saved;
    }

    async getTodayAppointments(user: AuthUser) {
    const doctorId = user?.doctorId;
    if (!doctorId) {
        throw new BadRequestException('Missing doctorId in user context');
    }
    // Query directly against the persisted snapshot instead of deriving from shift data.
    const { startEpoch: todayStartEpoch, endEpoch: nextDayStartEpoch, dateKey } = AppointmentTimeHelper.getUtcDayRangeForLocalDate();
    console.log(`[AppointmentService] using local dateKey=${dateKey}`);
        console.log(`[AppointmentService] getTodayAppointments doctorId=${doctorId} dateKey=${dateKey}`);

        const filter: any = {
            doctorId,
            $expr: {
                $and: [
                    { $gte: [{ $ifNull: ['$scheduledAt', '$date'] }, todayStartEpoch] },
                    { $lt: [{ $ifNull: ['$scheduledAt', '$date'] }, nextDayStartEpoch] },
                ],
            },
                };

        console.log('[AppointmentService] Mongo filter for today:', JSON.stringify(filter));

        const appointments: any[] = await this.appointmentModel.find(filter)
            // populate full patient document: profile and their appointments (with timeslot)
            .populate({
                path: 'patientId',
                populate: [
                    { path: 'profileId', select: 'name phone address email gender dob avatarUrl' },
                    // { path: 'appointments', populate: { path: 'timeSlot', select: 'start end label' }, select: '_id date appointmentStatus serviceType consultationFee reasonForAppointment timeSlot' }
                ]
            })
            .populate('timeSlot', 'start end label shift status')
            .lean() as any[];

        return {
            code: "SUCCESS",
            message: "Lấy danh sách lịch hẹn hôm nay thành công",
            data: appointments.map((a: any) => {
                const timeSlot = a.timeSlot as any;
                return {
                    _id: a._id,
                    date: a.scheduledAt ?? a.date,
                    scheduledAt: a.scheduledAt ?? a.date,
                    startTime: a.startTime ?? null,
                    endTime: a.endTime ?? null,
                    appointmentStatus: a.appointmentStatus,
                    serviceType: a.serviceType,
                    consultationFee: a.consultationFee,
                    reasonForAppointment: a.reasonForAppointment,
                    // listAppointments: only include patient's completed appointments
                    // listAppointments: (a.patientId?.appointments ?? []).filter((ap: any) => ap.appointmentStatus === 'COMPLETED'),
                    // Return full patient object (all populated properties)
                    patient: a.patientId ?? null,
                    label: timeSlot?.label ?? null,
                    status: timeSlot?.status ?? null,
                };
            })
        };
    }

    async completeAppointment(dto: CompleteAppointmentDto) {
    const appointment = await this.appointmentModel.findById(dto.appointmentId);
    if (!appointment) throw new NotFoundException('Appointment not found');

    const visitResult = dto.visitId
        ? await this.visitService.completeVisit(dto.visitId, dto)
        : await this.visitService.completeVisitByAppointmentId(dto.appointmentId, dto);

    // Reward coin after the visit is committed so the compatibility wrapper stays side-effect safe.
    const rewardResult = await this.coinService.rewardCoinForCompletedAppointment(
        appointment.patientId.toString(),
        appointment._id.toString(),
        Math.max(0, Math.floor(appointment.consultationFee ?? 0)),
    );
    if (rewardResult.rewarded) {
        console.log(
            `[AppointmentService] Rewarded ${rewardResult.amount} coin for completed appointment ${appointment._id.toString()}`,
        );
    } else {
        console.log(
            `[AppointmentService] Coin reward skipped for appointment ${appointment._id.toString()}: ${rewardResult.message}`,
        );
    }

    const patient = await this.patientModel.findById(appointment.patientId);
    if (!patient) throw new NotFoundException('Patient not found');

    return {
        code: 'SUCCESS',
        message: 'Appointment completed and encounter stored',
        data: {
            appointmentId: appointment._id,
            patientId: patient._id,
            encounterId: visitResult.encounterId,
            visitId: visitResult.visit._id,
        },
    };

}
    async findById(id: string) {
        return this.appointmentModel
        .findById(id)
        .populate('timeSlot')
        .populate('patientId')
        .populate('doctorId')
        .populate('specialtyId')
        .exec();
  }

    async getAllAppointments() : Promise<Appointment[]> {
        return this.appointmentModel.find().exec();
    }

    async getAppointmentsByPatient(
        user: AuthUser,
        page: number = 1,
        limit: number = 10
    ): Promise<{ data: AppointmentDto[]; total: number; page: number; limit: number; totalPages: number }> {
        const patientEmail = user?.email;
        if (!patientEmail) {
            throw new BadRequestException('Missing email in user context');
        }
        const skip = (page - 1) * limit;

        const [appointments, total] = await Promise.all([
            this.appointmentModel
                .find({ patientEmail })
                .populate('timeSlot', 'start end label shift status')
                .populate({
                    path: 'doctorId',
                    select: 'profileId',
                    populate: {
                        path: 'profileId',
                        select: 'name email phone',
                    },
                })
                .populate({
                    path: 'patientId',
                    select: 'profileId',
                    populate: {
                        path: 'profileId',
                        select: 'name email phone',
                    },
                })
                .sort({ scheduledAt: -1, date: -1, createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean()
                .exec() as unknown as AppointmentDto[],
            this.appointmentModel.countDocuments({ patientEmail }),
        ]);

        const totalPages = Math.ceil(total / limit);

        return {
            data: appointments,
            total,
            page,
            limit,
            totalPages,
        };
    }

    async updateAppointmentStatus(appointmentId: string, status: AppointmentStatus) {
        const appointment = await this.appointmentModel.findById(appointmentId);
        if (!appointment) {
            throw new NotFoundException('Appointment not found');
        }
        appointment.appointmentStatus = status;
        await appointment.save();
        console.log(`[AppointmentService] Updated appointment ${appointmentId} status to ${status}`);    
    }

    async findAll(query: any) {
    const {
        doctorId,
        patientId,
        appointmentStatus,
        keyword,
        scheduledAtFrom,
        scheduledAtTo,
        dateFrom,
        dateTo,
        page = 1,
        limit = 10,
    } = query;

    const filter: any = {};

    if (doctorId) filter.doctorId = doctorId;
    if (patientId) filter.patientId = patientId;
    if (appointmentStatus) filter.appointmentStatus = appointmentStatus;

    if (keyword) {
        const regex = new RegExp(keyword, "i");

        // Tìm bác sĩ theo doctorName
        const doctorMatches = await this.doctorModel.find(
            { doctorName: regex },
            "_id"
        );

        // Tìm profile bệnh nhân theo name
        const profileMatches = await this.profileModel.find(
            { name: regex },
            "_id"
        );

        // Tìm patientId theo profileId
        const patientMatches = await this.patientModel.find(
            { profileId: { $in: profileMatches.map(p => p._id) } },
            "_id"
        );

        filter.$or = [
            { _id: keyword.match(/^[0-9a-fA-F]{24}$/) ? keyword : undefined },
            { doctorId: { $in: doctorMatches.map(d => d._id) } },
            { patientId: { $in: patientMatches.map(p => p._id) } },
        ];
    }

    const rangeStart = scheduledAtFrom ?? dateFrom;
    const rangeEnd = scheduledAtTo ?? dateTo;
    if (rangeStart || rangeEnd) {
        // Range filters fall back to the legacy date field during the migration window.
        const scheduledRange: Record<string, number> = {};
        if (rangeStart) {
            scheduledRange.$gte = TimeHelper.toEpoch(TimeHelper.parseISOToUTC(rangeStart));
        }
        if (rangeEnd) {
            scheduledRange.$lte = TimeHelper.toEpoch(TimeHelper.parseISOToUTC(rangeEnd));
        }

        filter.$expr = {
            $and: [
                ...(scheduledRange.$gte !== undefined ? [{ $gte: [{ $ifNull: ['$scheduledAt', '$date'] }, scheduledRange.$gte] }] : []),
                ...(scheduledRange.$lte !== undefined ? [{ $lte: [{ $ifNull: ['$scheduledAt', '$date'] }, scheduledRange.$lte] }] : []),
            ],
        };
    }

    const skip = (page - 1) * limit;

    const data = await this.appointmentModel
        .find(filter)
        .populate('timeSlot')
        .populate({
            path: 'patientId',
            select: 'profileId',
            populate: {
                path: 'profileId',
                select: 'name email phone avatarUrl',
            },
        })
        .populate({
            path: 'doctorId',
            populate: [
                {
                    path: 'profileId',
                    select: 'name email phone avatarUrl',
                },
                {
                    path: 'chuyenKhoaId',
                    select: 'name',
                }
            ]
        })

        .skip(skip)
        .limit(Number(limit))
        .sort({ scheduledAt: -1, date: -1, createdAt: -1 })
        .exec();

    const total = await this.appointmentModel.countDocuments(filter);

    return {
        code: 200,
        message: "Get appointments successfully",
        data,
        pagination: {
            total,
            page: Number(page),
            limit: Number(limit),
            totalPages: Math.ceil(total / limit),
        },
    };
}

    async cancelAppointment(appointmentId: string, reason?: string, user?: AuthUser) {
        const appointment = await this.appointmentModel.findById(appointmentId);
        if (!appointment) {
            throw new NotFoundException('Appointment not found');
        }
        this.assertCanCancelAppointment(appointment, user);

        const previousStatus = appointment.appointmentStatus;
        if (![AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED].includes(previousStatus)) {
            this.throwCancelBlocked(
                'APPOINTMENT_NOT_CANCELABLE',
                `Cannot cancel appointment with status ${previousStatus}`,
            );
        }

        const appointmentScheduledAt = AppointmentTimeHelper.resolveStoredScheduledAt(appointment);
        if (!appointmentScheduledAt) {
            this.throwCancelBlocked('APPOINTMENT_NOT_CANCELABLE', 'Invalid appointment date');
        }
        const appointmentDate = TimeHelper.fromEpoch(appointmentScheduledAt);

        console.log(`[AppointmentService] Cancelling appointment ${appointmentId} scheduled at ${appointmentDate}, reason: ${reason}`);
        const appointmentTime = appointmentScheduledAt;
        const currentTime = Date.now();
        const hoursUntilAppointment = (appointmentTime - currentTime) / (1000 * 60 * 60);

        if (hoursUntilAppointment <= 24) {
            this.throwCancelBlocked(
                'APPOINTMENT_NOT_CANCELABLE',
                `Cannot cancel appointment within 24 hours of scheduled time. Hours remaining: ${hoursUntilAppointment.toFixed(1)}`,
            );
        }

        const timeSlotId = appointment.timeSlot;
        let refundAmount = 0;
        let refundReason = 'No verified paid DICH_VU deposit to refund';
        let shouldRefund = false;

        const doctorProfile = appointment.doctorId
            ? await this.doctorModel.findById(appointment.doctorId).populate('profileId', 'name email').lean()
            : null;
        const doctorEmail = (doctorProfile as any)?.profileId?.email as string | undefined;
        const doctorName = (doctorProfile as any)?.profileId?.name as string | undefined;

        const timeSlotDoc = await this.timeSlotLogModel.findById(timeSlotId).lean();
        const timeSlotLabel = (timeSlotDoc as any)?.label ?? `${(timeSlotDoc as any)?.start ?? ''}-${(timeSlotDoc as any)?.end ?? ''}`;
        const cancellationPayload = {
            appointmentId,
            patientId: appointment.patientId?.toString?.() ?? '',
            patientEmail: appointment.patientEmail,
            doctorEmail,
            doctorName,
            // Downstream listeners still expect a readable date value alongside the snapshot.
            date: appointmentDate,
            scheduledAt: appointmentScheduledAt,
            timeSlot: timeSlotId.toString(),
            timeSlotLabel,
            hospitalName: appointment.hospitalName,
            reason: reason || 'Appointment cancelled',
            refundAmount,
            refundReason,
            shouldRefund,
            status: AppointmentStatus.CANCELLED,
        };

        const session = await this.appointmentModel.db.startSession();
        try {
            await session.withTransaction(async () => {
                const freshAppointment = await this.appointmentModel.findById(appointmentId).session(session);
                if (!freshAppointment) {
                    throw new NotFoundException('Appointment not found');
                }

                if (![AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED].includes(freshAppointment.appointmentStatus)) {
                    this.throwCancelBlocked(
                        'APPOINTMENT_NOT_CANCELABLE',
                        `Cannot cancel appointment with status ${freshAppointment.appointmentStatus}`,
                    );
                }
                this.assertCanCancelAppointment(freshAppointment, user);

                // Re-check timing from the transactional snapshot so a concurrent reschedule cannot bypass policy.
                const freshScheduledAt = AppointmentTimeHelper.resolveStoredScheduledAt(freshAppointment);
                if (!freshScheduledAt) {
                    this.throwCancelBlocked('APPOINTMENT_NOT_CANCELABLE', 'Invalid appointment date');
                }
                const freshHoursUntilAppointment = (freshScheduledAt - Date.now()) / (1000 * 60 * 60);
                if (freshHoursUntilAppointment <= 24) {
                    this.throwCancelBlocked(
                        'APPOINTMENT_NOT_CANCELABLE',
                        `Cannot cancel appointment within 24 hours of scheduled time. Hours remaining: ${freshHoursUntilAppointment.toFixed(1)}`,
                    );
                }

                const depositPayments = await this.paymentModel
                    .find({
                        appointmentId: freshAppointment._id,
                        purpose: PaymentPurposeEnum.APPOINTMENT_DEPOSIT,
                    })
                    .session(session)
                    .exec();
                if (depositPayments.length > 1) {
                    this.throwCancelBlocked(
                        'APPOINTMENT_DEPOSIT_PAYMENT_AMBIGUOUS',
                        'Cannot cancel appointment because multiple deposit payments exist',
                    );
                }

                const depositPayment = depositPayments[0];
                if (depositPayment?.status === PaymentFlowStatusEnum.PENDING) {
                    this.throwCancelBlocked(
                        'APPOINTMENT_DEPOSIT_PAYMENT_PENDING',
                        'Cannot cancel appointment while deposit payment callback is pending',
                    );
                }

                const visit = await this.visitModel
                    .findOne({ appointmentId: freshAppointment._id })
                    .session(session)
                    .exec();
                if (!visit) {
                    this.throwCancelBlocked(
                        'APPOINTMENT_NOT_CANCELABLE',
                        'Cannot cancel appointment because visit record is missing',
                    );
                }

                if (visit.status === VisitStatus.COMPLETED) {
                    this.throwCancelBlocked('VISIT_COMPLETED', 'Cannot cancel appointment because visit is completed');
                }

                if (visit.status !== VisitStatus.CREATED) {
                    this.throwCancelBlocked(
                        'VISIT_ALREADY_STARTED',
                        `Cannot cancel appointment because visit status is ${visit.status}`,
                    );
                }

                const encounterExists = await this.medicalEncounterModel.exists({
                    $or: [
                        { visitId: visit._id },
                        { appointmentId: freshAppointment._id },
                    ],
                }).session(session);
                if (encounterExists) {
                    this.throwCancelBlocked('MEDICAL_ENCOUNTER_EXISTS', 'Cannot cancel appointment because medical encounter exists');
                }

                const billing = await this.billingModel
                    .findOne({ visitId: visit._id })
                    .session(session)
                    .select('_id')
                    .lean()
                    .exec();
                const paymentExists = billing
                    ? await this.paymentModel.exists({ billingId: billing._id }).session(session)
                    : null;
                if (paymentExists) {
                    this.throwCancelBlocked('PAYMENT_EXISTS', 'Cannot cancel appointment because payment exists');
                }

                if (billing) {
                    this.throwCancelBlocked('BILLING_EXISTS', 'Cannot cancel appointment because billing exists');
                }

                const hasVerifiedPaidDeposit =
                    freshAppointment.paymentCategory === PaymentCategory.DICH_VU &&
                    freshAppointment.depositStatus === DepositStatus.PAID &&
                    freshAppointment.depositPaidAmount > 0;
                if (hasVerifiedPaidDeposit && (!depositPayment || depositPayment.status !== PaymentFlowStatusEnum.SUCCESS)) {
                    this.throwCancelBlocked(
                        'APPOINTMENT_DEPOSIT_PAYMENT_INCONSISTENT',
                        'Cannot cancel appointment because verified deposit state is inconsistent',
                    );
                }
                if (!hasVerifiedPaidDeposit && depositPayment?.status === PaymentFlowStatusEnum.SUCCESS) {
                    this.throwCancelBlocked(
                        'APPOINTMENT_DEPOSIT_PAYMENT_INCONSISTENT',
                        'Cannot cancel appointment because successful deposit payment evidence is inconsistent',
                    );
                }

                if (hasVerifiedPaidDeposit) {
                    const refundRate = this.getCancelRefundRate();
                    // Refund is derived only from verified paid deposit evidence, never intended or legacy amounts.
                    refundAmount = Math.max(0, Math.floor(freshAppointment.depositPaidAmount * refundRate));
                    refundReason = `Refunded verified appointment deposit at ${(refundRate * 100).toFixed(0)}% rate`;
                    shouldRefund = refundAmount > 0;
                    if (shouldRefund) {
                        await this.creditService.refundAppointmentCancellation(
                            freshAppointment.patientId.toString(),
                            refundAmount,
                            appointmentId,
                            reason || 'Appointment cancelled',
                            session,
                        );
                        freshAppointment.depositStatus = DepositStatus.REFUNDED;
                        depositPayment.refundedAt = new Date();
                        await depositPayment.save({ session });
                    } else {
                        // A zero configured rate explicitly forfeits the verified deposit.
                        freshAppointment.depositStatus = DepositStatus.FORFEITED;
                    }
                }

                // Keep appointment, visit, and slot state aligned so cancellation cannot leave an active visit.
                freshAppointment.appointmentStatus = AppointmentStatus.CANCELLED;
                await freshAppointment.save({ session });

                visit.status = VisitStatus.CANCELLED;
                await visit.save({ session });

                if (freshAppointment.timeSlot) {
                    const slotRelease = await this.timeSlotLogModel.updateOne(
                        { _id: freshAppointment.timeSlot, status: 'booked' },
                        { $set: { status: 'available' } },
                        { session },
                    );
                    if (slotRelease.modifiedCount !== 1) {
                        this.throwCancelBlocked(
                            'TIME_SLOT_RELEASE_FAILED',
                            'Cannot cancel appointment because booked time slot could not be released',
                        );
                    }
                }
            });
        } finally {
            await session.endSession();
        }

        console.log(`[AppointmentService] Cancelled appointment ${appointmentId}; refund=${refundAmount} (${refundReason})`);

        cancellationPayload.refundAmount = refundAmount;
        cancellationPayload.refundReason = refundReason;
        cancellationPayload.shouldRefund = shouldRefund;
        this.eventEmitter.emit('notify.patient.appointment.cancelled', cancellationPayload);
        this.eventEmitter.emit('mail.patient.appointment.cancelled', cancellationPayload);
        this.eventEmitter.emit('socket.appointment.cancelled', cancellationPayload);

        return {
            code: 'SUCCESS',
            message: 'Appointment cancelled',
            data: {
                appointmentId,
                refundAmount,
                refundReason,
                hoursUntilAppointment,
            },
        };
    }

    async getDepositStatus(appointmentId: string, user?: AuthUser) {
        if (!Types.ObjectId.isValid(appointmentId)) {
            throw new NotFoundException('Appointment not found');
        }

        const appointment = await this.appointmentModel.findById(appointmentId).lean().exec();
        if (!appointment) {
            throw new NotFoundException('Appointment not found');
        }
        this.assertCanViewDepositStatus(appointment, user);

        let payment: { _id: Types.ObjectId; status: PaymentFlowStatusEnum } | null = null;
        if (appointment.paymentCategory === PaymentCategory.DICH_VU) {
            const paymentReferences: Record<string, unknown>[] = [{ appointmentId: appointment._id }];
            if (appointment.depositPaymentId) {
                paymentReferences.unshift({ _id: appointment.depositPaymentId });
            }

            // Read the linked deposit record only; polling must never create or refresh a payment.
            payment = await this.paymentModel
                .findOne({
                    purpose: PaymentPurposeEnum.APPOINTMENT_DEPOSIT,
                    $or: paymentReferences,
                })
                .select('_id status')
                .lean()
                .exec();
        }

        const isConfirmed =
            appointment.appointmentStatus === AppointmentStatus.CONFIRMED ||
            appointment.appointmentStatus === AppointmentStatus.COMPLETED;
        const terminalDepositStatuses = [
            DepositStatus.NOT_REQUIRED,
            DepositStatus.PAID,
            DepositStatus.FAILED,
            DepositStatus.REFUNDED,
            DepositStatus.FORFEITED,
        ];
        const isTerminal =
            terminalDepositStatuses.includes(appointment.depositStatus) ||
            appointment.appointmentStatus === AppointmentStatus.FAILED ||
            appointment.appointmentStatus === AppointmentStatus.CANCELLED;

        return {
            appointmentId: appointment._id.toString(),
            appointmentStatus: appointment.appointmentStatus,
            paymentCategory: appointment.paymentCategory,
            depositStatus: appointment.depositStatus,
            depositAmount: appointment.depositAmount ?? 0,
            depositPaidAmount: appointment.depositPaidAmount ?? 0,
            depositPaidAt: appointment.depositPaidAt ?? null,
            depositPaymentId: appointment.depositPaymentId?.toString() ?? payment?._id?.toString() ?? null,
            paymentStatus: payment?.status ?? null,
            paymentUrl: null,
            isConfirmed,
            isTerminal,
        };
    }

    private throwCancelBlocked(blockedReason: string, message: string): never {
        throw new BadRequestException({
            code: ResponseCode.ERROR,
            message,
            data: { blockedReason },
        });
    }

    private assertCanCancelAppointment(appointment: AppointmentDocument, user?: AuthUser): void {
        const isStaff = user?.role === RoleEnum.ADMIN || user?.role === RoleEnum.RECEPTIONIST;
        const isOwner =
            user?.role === RoleEnum.PATIENT &&
            Boolean(user.patientId) &&
            appointment.patientId?.toString?.() === user.patientId;
        if (!isStaff && !isOwner) {
            throw new ForbiddenException('You do not have permission to cancel this appointment');
        }
    }

    private assertCanViewDepositStatus(appointment: Pick<Appointment, 'patientId'>, user?: AuthUser): void {
        const isStaff = user?.role === RoleEnum.ADMIN || user?.role === RoleEnum.RECEPTIONIST;
        const isOwner =
            user?.role === RoleEnum.PATIENT &&
            Boolean(user.patientId) &&
            appointment.patientId?.toString?.() === user.patientId;
        if (!isStaff && !isOwner) {
            throw new ForbiddenException('You do not have permission to view this appointment deposit status');
        }
    }

    private getCancelRefundRate(): number {
        const configuredRate = Number(this.config.get<string>('APPOINTMENT_CANCEL_REFUND_RATE') ?? 1);
        return Number.isFinite(configuredRate) ? Math.min(1, Math.max(0, configuredRate)) : 1;
    }

    async confirmAppointment(id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid appointment id');
    }

    const appointment = await this.appointmentModel.findById(id);

    if (!appointment) {
      throw new NotFoundException('Appointment not found');
    }

    if (appointment.appointmentStatus !== AppointmentStatus.PENDING) {
      throw new BadRequestException('Appointment cannot be confirmed');
    }

    appointment.appointmentStatus = AppointmentStatus.CONFIRMED;

    await appointment.save();

    return {
      message: 'Appointment confirmed successfully',
      data: appointment,
    };
  }

    async findCompletedByDoctor(
    user: AuthUser,
    page = 1,
    limit = 10,
    keyword?: string,
    patientId?: string,
    ): Promise<
    DataResponse<{
        items: any[];
        pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
        };
    }>
    > {
    const skip = (page - 1) * limit;

    const buildFuzzyRegex = (keyword: string) => {
        const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(escaped.split('').join('.*'), 'i');
    };

    const regex = keyword ? buildFuzzyRegex(keyword.trim()) : null;

    const doctorId = user?.doctorId;
    if (!doctorId) {
        throw new BadRequestException('Missing doctorId in user context');
    }

    const matchStage: any = {
        doctorId: new mongoose.Types.ObjectId(doctorId),
        appointmentStatus: AppointmentStatus.COMPLETED,
    };

    if (patientId) {
        matchStage.patientId = new mongoose.Types.ObjectId(patientId);
    }

    const pipeline: any[] = [
    { $match: matchStage },

    {
        $lookup: {
        from: 'timeslotslog',
        localField: 'timeSlot',
        foreignField: '_id',
        as: 'timeSlot',
        },
    },
    { $unwind: '$timeSlot' },

    {
        $lookup: {
        from: 'patients',
        localField: 'patientId',
        foreignField: '_id',
        as: 'patient',
        },
    },
    { $unwind: '$patient' },

    {
        $lookup: {
        from: 'profiles',
        localField: 'patient.profileId',
        foreignField: '_id',
        as: 'patient.profile',
        },
    },
    { $unwind: '$patient.profile' },

    {
        $addFields: {
        appointmentMedicalRecord: {
            $filter: {
            input: '$patient.medicalRecord.medicalHistory',
            as: 'history',
            cond: {
                $eq: ['$$history.appointmentId', '$_id'],
            },
            },
        },
        },
    },
    {
        $addFields: {
        appointmentMedicalRecord: {
            $arrayElemAt: ['$appointmentMedicalRecord', 0],
        },
        },
    },

    {
        $lookup: {
        from: 'reviews',
        let: { appointmentId: '$_id' },
        pipeline: [
            {
            $match: {
                $expr: {
                $eq: ['$appointmentId', '$$appointmentId'],
                },
            },
            },
            {
            $project: {
                _id: 0,
                rating: 1,
                comment: 1,
                createdAt: 1,
            },
            },
        ],
        as: 'review',
        },
    },
    {
        $addFields: {
        review: {
            $arrayElemAt: ['$review', 0],
        },
        },
    },
    ];


    if (regex) {
        pipeline.push({
        $match: {
            $or: [
            { 'patient.profile.name': regex },
            { 'appointmentMedicalRecord.diagnosis': regex },
            ],
        },
        });
    }

    pipeline.push(
        {
        $addFields: {
            // Use the new snapshot field first and fall back to legacy date for older records.
            appointmentDateEpoch: { $ifNull: ['$scheduledAt', '$date'] },
        },
        },
        { $sort: { appointmentDateEpoch: -1 } },
        { $project: { appointmentDateEpoch: 0 } },
        {
        $facet: {
            items: [
            { $skip: skip },
            { $limit: limit },
            ],
            totalCount: [
            { $count: 'count' },
            ],
        },
        },
    );

    const result = await this.appointmentModel.aggregate(pipeline);

    const items = result[0]?.items || [];
    const total = result[0]?.totalCount[0]?.count || 0;

    return {
        code: ResponseCode.SUCCESS,
        message: 'Lấy danh sách buổi hẹn đã hoàn thành theo bác sĩ thành công',
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

}
