import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { InjectModel } from "@nestjs/mongoose";
import mongoose, { Model, Types } from "mongoose";
import { DataResponse } from "src/common/dto/data-respone";
import { ResponseCode } from "src/common/enum/reponse-code.enum";
import { RoleEnum } from "src/common/enum/role.enum";
import { Doctor, DoctorDocument } from "src/doctor/schema/doctor.schema";
import { Medicine, MedicineDocument } from "src/medicine/schema/medicine.schema";
import { MedicalEncounter, MedicalEncounterDocument } from "src/patient/schema/medical-record.schema";
import { Patient, PatientDocument } from "src/patient/schema/patient.schema";
import { Profile, ProfileDocument } from "src/profile/schema/profile.schema";
import { TimeSlotLog, TimeSlotLogDocument } from "src/timeslot/schemas/timeslot-log.schema";
import { AppointmentBookingDto, CompleteAppointmentDto } from "./dto/appointment-booking.dto";
import { AppointmentDto } from "./dto/appointment.dto";
import { AppointmentStatus } from "./enums/Appointment-status.enum";
import { Appointment, AppointmentDocument } from "./schemas/appointment.schema";

@Injectable()
export class AppointmentService {

    constructor(private readonly eventEmitter: EventEmitter2,
        @InjectModel(Appointment.name) private readonly appointmentModel: Model<Appointment>,
        @InjectModel(TimeSlotLog.name) private readonly timeSlotLogModel: Model<TimeSlotLogDocument>,
        @InjectModel(Patient.name) private readonly patientModel: Model<PatientDocument>,
        @InjectModel(MedicalEncounter.name) private readonly medicalEncounterModel: Model<MedicalEncounterDocument>,
        @InjectModel(Medicine.name) private readonly medicineModel: Model<MedicineDocument>,
        @InjectModel(Doctor.name) private readonly doctorModel: Model<DoctorDocument>,
        @InjectModel(Profile.name) private readonly profileModel: Model<ProfileDocument>,
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
        const appointmentDoc = new this.appointmentModel({
            date: payload.date,
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

    async getTodayAppointments(doctorId: string) {
    const today = new Date();
    const localYear = today.getFullYear();
    const localMonth = String(today.getMonth() + 1).padStart(2, '0');
    const localDay = String(today.getDate()).padStart(2, '0');
    const formatted = `${localYear}-${localMonth}-${localDay}`; // yyyy-mm-dd in local timezone
    console.log(`[AppointmentService] using local date formatted=${formatted} timezoneOffsetMinutes=${today.getTimezoneOffset()}`);
        console.log(`[AppointmentService] getTodayAppointments doctorId=${doctorId} formatted=${formatted}`);

        const filter: any = {
            doctorId,
            $or: [
                { date: formatted },
                {
                    $expr: {
                        $eq: [
                            { $dateToString: { format: "%Y-%m-%d", date: "$date" } },
                            formatted
                                ]
                            }
                        }
                    ]
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
                    date: a.date,
                    appointmentStatus: a.appointmentStatus,
                    serviceType: a.serviceType,
                    consultationFee: a.consultationFee,
                    reasonForAppointment: a.reasonForAppointment,
                    // listAppointments: only include patient's completed appointments
                    // listAppointments: (a.patientId?.appointments ?? []).filter((ap: any) => ap.appointmentStatus === 'COMPLETED'),
                    // Return full patient object (all populated properties)
                    patient: a.patientId ?? null,
                    startTime: timeSlot?.start ?? null,
                    endTime: timeSlot?.end ?? null, 
                    label: timeSlot?.label ?? null,
                    status: timeSlot?.status ?? null,
                };
            })
        };
    }

    async completeAppointment(dto: CompleteAppointmentDto) {
    const appointment = await this.appointmentModel.findById(dto.appointmentId);
    if (!appointment) throw new NotFoundException('Appointment not found');

    const timeSlot = await this.timeSlotLogModel.findById(appointment.timeSlot);
    if (!timeSlot) throw new NotFoundException('TimeSlot not found');

    timeSlot.status = 'completed';
    await timeSlot.save();

    appointment.appointmentStatus = AppointmentStatus.COMPLETED;
    await appointment.save();

    const patient = await this.patientModel.findById(appointment.patientId);
    if (!patient) throw new NotFoundException('Patient not found');

    // Build prescriptions
    const mappedPrescriptions = await Promise.all((dto.prescriptions || []).map(async (p) => {
        let medicineIdObj: Types.ObjectId | null = null;
        
        console.log('[CompleteAppointment] Processing prescription item:', p);

        // Only convert medicineId if it exists
        if (p.medicineId) {
            try {
                medicineIdObj = (typeof p.medicineId === 'string') 
                    ? new Types.ObjectId(p.medicineId) 
                    : p.medicineId;
            } catch (err) {
                console.warn('[CompleteAppointment] Invalid medicineId:', p.medicineId);
                medicineIdObj = null;
            }
        }
        
        let name = p.name;
        // If no name provided but have medicineId, fetch from database
        if (!name && medicineIdObj) {
            try {
                const med = await this.medicineModel.findById(medicineIdObj).select('name').lean();
                name = med?.name ?? p.name ?? 'Unknown medicine';
            } catch (err) {
                name = p.name ?? 'Unknown medicine';
            }
        }
        
        const prescription: any = {
            name,
            quantity: (typeof p.quantity === 'number' && p.quantity > 0) ? p.quantity : 1,
            note: p.note,
        };
        
        // Only add medicineId if it exists
        if (medicineIdObj) {
            prescription.medicineId = medicineIdObj;
        }
        
        return prescription;
    }));

    console.log('[AppointmentService] Mapped prescriptions:', mappedPrescriptions);

    if (!appointment.doctorId) {
        throw new NotFoundException('Doctor not assigned to appointment');
    }

    const encounter = await this.medicalEncounterModel.findOneAndUpdate(
        { appointmentId: appointment._id },
        {
            $setOnInsert: {
                appointmentId: appointment._id,
                patientId: appointment.patientId,
                createdByDoctorId: appointment.doctorId,
                createdByRole: RoleEnum.DOCTOR,
                diagnosis: dto.diagnosis,
                note: dto.note ?? '',
                prescriptions: mappedPrescriptions,
                vitalSigns: [],
                dateRecord: new Date(),
            },
        },
        {
            upsert: true,
            new: true,
            setDefaultsOnInsert: true,
        },
    );

    console.log('[AppointmentService] Medical encounter saved:', JSON.stringify(encounter.toObject(), null, 2));

        // Persist legacy embedded medical history for backward-compatible reads
        // Some queries (e.g. aggregation in findCompletedByDoctor) still read from patient.medicalRecord.medicalHistory
        try {
            // Ensure medicalRecord exists
            if (!patient.medicalRecord) {
                (patient as any).medicalRecord = {
                    height: undefined,
                    weight: undefined,
                    bloodType: undefined,
                    medicalHistory: [],
                    drugAllergies: [],
                    foodAllergies: [],
                    bloodPressure: [],
                    heartRate: [],
                };
            }

            const legacyPrescription = mappedPrescriptions.map(p => ({
                medicineId: p.medicineId,
                name: p.name,
                quantity: p.quantity,
                note: p.note,
            }));

            (patient as any).medicalRecord.medicalHistory.push({
                diagnosis: dto.diagnosis,
                prescriptions: legacyPrescription,
                note: dto.note ?? '',
                dateRecord: new Date(),
                appointmentId: appointment._id,
            });

            await patient.save();
            console.log('[AppointmentService] Embedded medicalRecord.medicalHistory updated for patient', String(patient._id));
        } catch (err) {
            console.warn('[AppointmentService] Failed to update embedded medical history:', err);
        }

    return {
        code: 'SUCCESS',
        message: 'Appointment completed and encounter stored',
        data: {
            appointmentId: appointment._id,
            patientId: patient._id,
            encounterId: encounter._id,
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

    async getAppointmentsByPatientEmail(
        patientEmail: string,
        page: number = 1,
        limit: number = 10
    ): Promise<{ data: AppointmentDto[]; total: number; page: number; limit: number; totalPages: number }> {
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
                .sort({ createdAt: -1 })
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
        .sort({ createdAt: -1 })
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
async rescheduleAppointment(appointmentId: string, newDate: Date, newTimeSlotId: string, reason?: string) {
        const appointment = await this.appointmentModel.findById(appointmentId);
        if (!appointment) {
            throw new NotFoundException('Appointment not found');
        }

        // Only allow rescheduling for PENDING or CONFIRMED appointments
        if (![AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED].includes(appointment.appointmentStatus)) {
            throw new Error(`Cannot reschedule appointment with status ${appointment.appointmentStatus}`);
        }

        // ⏰ Time-based reschedule restriction: Cannot reschedule if <= 24 hours before appointment
        const appointmentTime = new Date(appointment.date).getTime();
        const currentTime = Date.now();
        const hoursUntilAppointment = (appointmentTime - currentTime) / (1000 * 60 * 60);

        if (hoursUntilAppointment <= 24) {
            throw new Error(`Cannot reschedule appointment within 24 hours of scheduled time. Hours remaining: ${hoursUntilAppointment.toFixed(1)}`);
        }

        // 💰 Tiered refund logic for reschedule (same as cancel)
        const oldTimeSlotId = appointment.timeSlot;
        const consultationFee = appointment.consultationFee || 0;
        let refundAmount = 0;
        let refundReason = '';

        if (hoursUntilAppointment > 48) {
            refundAmount = consultationFee;
            refundReason = '100% refund (rescheduled > 48 hours before)';
        } else if (hoursUntilAppointment > 24) {
            refundAmount = Math.ceil(consultationFee * 0.5); // 50% refund
            refundReason = '50% refund (rescheduled 24-48 hours before)';
        }

        // Update appointment
        appointment.date = newDate;
        appointment.timeSlot = new Types.ObjectId(newTimeSlotId);
        appointment.appointmentStatus = AppointmentStatus.RESCHEDULED;
        await appointment.save();

        // Release old time slot
        const oldTimeSlot = await this.timeSlotLogModel.findById(oldTimeSlotId);
        if (oldTimeSlot) {
            oldTimeSlot.status = 'available';
            await oldTimeSlot.save();
        }

        // Book new time slot
        const newTimeSlot = await this.timeSlotLogModel.findById(newTimeSlotId);
        if (newTimeSlot) {
            newTimeSlot.status = 'booked';
            await newTimeSlot.save();
        }

        // Emit reschedule event for wallet refund processing (in coins, 1 coin = 1 VND)
        this.eventEmitter.emit('appointment.rescheduled', {
            appointmentId,
            patientId: appointment.patientId.toString(),
            consultationFee,
            refundAmount,
            refundReason,
            reason: reason || 'Appointment rescheduled',
            oldTimeSlotId: oldTimeSlotId.toString(),
            newTimeSlotId,
            newDate,
        });

        console.log(`[AppointmentService] Rescheduled appointment ${appointmentId} from slot ${oldTimeSlotId} to ${newTimeSlotId}, refund: ${refundAmount} coins (${refundReason})`);

        return {
            code: 'SUCCESS',
            message: `Appointment rescheduled successfully (${refundReason})`,
            data: {
                appointmentId,
                refundAmount,
                refundReason,
                newDate,
                hoursUntilAppointment: hoursUntilAppointment.toFixed(1),
            },
        };
    }


    async cancelAppointment(appointmentId: string, reason?: string) {
        const appointment = await this.appointmentModel.findById(appointmentId);
        if (!appointment) {
            throw new NotFoundException('Appointment not found');
        }

        const previousStatus = appointment.appointmentStatus;

        // Only allow cancelling for PENDING or CONFIRMED appointments
        if (![AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED].includes(previousStatus)) {
            throw new Error(`Cannot cancel appointment with status ${previousStatus}`);
        }

        // ⏰ Time-based cancellation restriction: Cannot cancel if <= 24 hours before appointment
        const appointmentTime = new Date(appointment.date).getTime();
        const currentTime = Date.now();
        const hoursUntilAppointment = (appointmentTime - currentTime) / (1000 * 60 * 60);

        if (hoursUntilAppointment <= 24) {
            throw new Error(`Cannot cancel appointment within 24 hours of scheduled time. Hours remaining: ${hoursUntilAppointment.toFixed(1)}`);
        }

        // 💰 Tiered refund logic based on cancellation timing
        const timeSlotId = appointment.timeSlot;
        const consultationFee = appointment.consultationFee || 0;
        let refundAmount = 0;
        let refundReason = '';

        if (previousStatus === AppointmentStatus.PENDING) {
            // PENDING appointments get 100% refund if cancelled > 48h before
            if (hoursUntilAppointment > 48) {
                refundAmount = consultationFee;
                refundReason = '100% refund (cancelled > 48 hours before)';
            } else if (hoursUntilAppointment > 24) {
                refundAmount = Math.ceil(consultationFee * 0.5); // 50% refund
                refundReason = '50% refund (cancelled 24-48 hours before)';
            }
        } else if (previousStatus === AppointmentStatus.CONFIRMED) {
            // CONFIRMED appointments follow same tier logic
            if (hoursUntilAppointment > 48) {
                refundAmount = consultationFee;
                refundReason = '100% refund (cancelled > 48 hours before)';
            } else if (hoursUntilAppointment > 24) {
                refundAmount = Math.ceil(consultationFee * 0.5); // 50% refund
                refundReason = '50% refund (cancelled 24-48 hours before)';
            }
            // < 24h returns 0 (already blocked above, but for clarity)
        }

        const shouldRefund = refundAmount > 0;

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
            date: appointment.date,
            timeSlot: timeSlotId.toString(),
            timeSlotLabel,
            hospitalName: appointment.hospitalName,
            reason: reason || 'Appointment cancelled',
            refundAmount,
            refundReason,
            shouldRefund,
            status: AppointmentStatus.CANCELLED,
        };

        // Update appointment
        appointment.appointmentStatus = AppointmentStatus.CANCELLED;
        await appointment.save();

        // Release time slot
        const timeSlot = await this.timeSlotLogModel.findById(timeSlotId);
        if (timeSlot) {
            timeSlot.status = 'available';
            await timeSlot.save();
        }

        if (shouldRefund && refundAmount > 0) {
            // Emit cancel event for wallet refund processing (in coins, 1 coin = 1 VND)
            this.eventEmitter.emit('appointment.cancelled', {
                appointmentId,
                patientId: appointment.patientId.toString(),
                consultationFee,
                refundAmount,
                refundReason,
                reason: reason || 'Appointment cancelled',
                timeSlotId: timeSlotId.toString(),
            });
            console.log(`[AppointmentService] Cancelled appointment ${appointmentId}, refund: ${refundAmount} coins (${refundReason})`);
        } else {
            console.log(`[AppointmentService] Cancelled appointment ${appointmentId} with no refund (${refundReason})`);
        }

        // Notify patient via notification, mail, and socket
        this.eventEmitter.emit('notify.patient.appointment.cancelled', cancellationPayload);
        this.eventEmitter.emit('mail.patient.appointment.cancelled', cancellationPayload);
        this.eventEmitter.emit('socket.appointment.cancelled', cancellationPayload);

        return {
            code: 'SUCCESS',
            message: shouldRefund
                ? `Appointment cancelled and refunded: ${refundReason}`
                : 'Appointment cancelled (no refund for cancellations within 24 hours)',
            data: {
                appointmentId,
                refundAmount,
                refundReason,
                hoursUntilAppointment: (appointmentTime - currentTime) / (1000 * 60 * 60),
            },
        };
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
    doctorId: string,
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
        { $sort: { date: -1 } },
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