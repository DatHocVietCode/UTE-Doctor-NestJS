import { Injectable, NotFoundException } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { InjectModel } from "@nestjs/mongoose";
import { Model, Types } from "mongoose";
import { DataResponse } from "src/common/dto/data-respone";
import { ResponseCode } from "src/common/enum/reponse-code.enum";
import { Medicine, MedicineDocument } from "src/medicine/schema/medicine.schema";
import { Patient, PatientDocument } from "src/patient/schema/patient.schema";
import { TimeSlotLog, TimeSlotLogDocument } from "src/timeslot/schemas/timeslot-log.schema";
import { AppointmentBookingDto, CompleteAppointmentDto } from "./dto/appointment-booking.dto";
import { AppointmentDto } from "./dto/appointment.dto";
import { AppointmentStatus } from "./enums/Appointment-status.enum";
import { Appointment, AppointmentDocument } from "./schemas/appointment.schema";
import { Doctor, DoctorDocument } from "src/doctor/schema/doctor.schema";
import { Profile, ProfileDocument } from "src/profile/schema/profile.schema";

@Injectable()
export class AppointmentService {

    constructor(private readonly eventEmitter: EventEmitter2,
        @InjectModel(Appointment.name) private readonly appointmentModel: Model<Appointment>,
        @InjectModel(TimeSlotLog.name) private readonly timeSlotLogModel: Model<TimeSlotLogDocument>,
        @InjectModel(Patient.name) private readonly patientModel: Model<PatientDocument>,
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
            specialtyId: payload.specialty,
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
                    { path: 'profileId', select: 'name phone address email gender dob' },
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
        const medicineIdObj = (typeof p.medicineId === 'string') 
            ? new Types.ObjectId(p.medicineId) 
            : p.medicineId;
        
        let name = p.name;
        if (!name) {
            try {
                const med = await this.medicineModel.findById(medicineIdObj).select('name').lean();
                name = med?.name ?? 'Unknown medicine';
            } catch (err) {
                name = 'Unknown medicine';
            }
        }
        
        return {
            medicineId: medicineIdObj,
            name,
            quantity: (typeof p.quantity === 'number' && p.quantity > 0) ? p.quantity : 1,
            note: p.note,
        };
    }));

    const newRecord = {
        diagnosis: dto.diagnosis,
        note: dto.note ?? '',
        dateRecord: new Date(),
        appointmentId: appointment._id,
        prescriptions: mappedPrescriptions,
    };

    console.log('[AppointmentService] Adding medical record:', JSON.stringify(newRecord, null, 2));

    // Ensure medicalRecord structure exists on the document so subdocuments save with schema casting
    if (!patient.medicalRecord) {
        patient.medicalRecord = {
            medicalHistory: [],
            drugAllergies: [],
            foodAllergies: [],
            bloodPressure: [],
            heartRate: []
        } as any;
    }

    // Sanitize existing medicalHistory entries and their prescriptions so Mongoose validation won't fail
    patient.medicalRecord.medicalHistory = patient.medicalRecord.medicalHistory || [];
    patient.medicalRecord.medicalHistory = (patient.medicalRecord.medicalHistory as any[]).map((rec: any) => {
        rec = rec || {};
        rec.diagnosis = rec.diagnosis ?? '';
        rec.note = rec.note ?? '';
        // Normalize dateRecord to Date or current date
        try {
            rec.dateRecord = rec.dateRecord ? new Date(rec.dateRecord) : new Date();
        } catch (err) {
            rec.dateRecord = new Date();
        }
        rec.appointmentId = rec.appointmentId ?? null;

        // Ensure prescriptions is an array of full objects
        rec.prescriptions = Array.isArray(rec.prescriptions) ? rec.prescriptions : [];
        rec.prescriptions = rec.prescriptions.map((pr: any) => {
            pr = pr || {};
            // preserve existing ObjectId values but cast strings to ObjectId
            try {
                pr.medicineId = pr.medicineId ? ((typeof pr.medicineId === 'string') ? new Types.ObjectId(pr.medicineId) : pr.medicineId) : undefined;
            } catch (e) {
                pr.medicineId = pr.medicineId;
            }
            pr.name = pr.name ?? 'Unknown medicine';
            pr.quantity = (typeof pr.quantity === 'number' && pr.quantity > 0) ? pr.quantity : 1;
            pr.note = pr.note ?? '';
            return pr;
        });

        return rec;
    });

    // Push the new record onto the document and save so Mongoose will cast subdocuments correctly
    patient.medicalRecord.medicalHistory.push(newRecord as any);

    const savedPatient = await patient.save();

    // Verify last record was saved with full fields
    const lastRecord = (savedPatient as any).medicalRecord?.medicalHistory?.slice(-1)[0];
    console.log('[AppointmentService] Last record after save:', JSON.stringify(lastRecord, null, 2));

    return {
        code: 'SUCCESS',
        message: 'Appointment completed and medical record updated',
        data: {
            appointmentId: appointment._id,
            patientId: patient._id,
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
                .sort({ date: -1 })
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
/**
     * Reschedule an appointment to a new date and time slot
     * Emits event with refund information (80% of consultation fee as coins)
     */
    async rescheduleAppointment(appointmentId: string, newDate: Date, newTimeSlotId: string, reason?: string) {
        const appointment = await this.appointmentModel.findById(appointmentId);
        if (!appointment) {
            throw new NotFoundException('Appointment not found');
        }

        // Only allow rescheduling for PENDING or CONFIRMED appointments
        if (![AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED].includes(appointment.appointmentStatus)) {
            throw new Error(`Cannot reschedule appointment with status ${appointment.appointmentStatus}`);
        }

        const oldTimeSlotId = appointment.timeSlot;
        const consultationFee = appointment.consultationFee || 0;
        const refundAmount = Math.ceil(consultationFee * 0.8); // 80% refund as coins

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

        // Emit reschedule event for wallet refund processing
        this.eventEmitter.emit('appointment.rescheduled', {
            appointmentId,
            patientId: appointment.patientId.toString(),
            consultationFee,
            refundAmount,
            reason: reason || 'Appointment rescheduled',
            oldTimeSlotId: oldTimeSlotId.toString(),
            newTimeSlotId,
            newDate,
        });

        console.log(`[AppointmentService] Rescheduled appointment ${appointmentId} from slot ${oldTimeSlotId} to ${newTimeSlotId}, refund: ${refundAmount} coins`);

        return {
            code: 'SUCCESS',
            message: 'Appointment rescheduled successfully',
            data: {
                appointmentId,
                refundAmount,
                newDate,
            },
        };
    }

    /**
     * Cancel an appointment and refund 100% of consultation fee as coins
     */
    async cancelAppointment(appointmentId: string, reason?: string) {
        const appointment = await this.appointmentModel.findById(appointmentId);
        if (!appointment) {
            throw new NotFoundException('Appointment not found');
        }

        // Only allow cancelling for PENDING or CONFIRMED appointments
        if (![AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED].includes(appointment.appointmentStatus)) {
            throw new Error(`Cannot cancel appointment with status ${appointment.appointmentStatus}`);
        }

        const timeSlotId = appointment.timeSlot;
        const consultationFee = appointment.consultationFee || 0;
        const refundAmount = consultationFee; // 100% refund as coins

        // Update appointment
        appointment.appointmentStatus = AppointmentStatus.CANCELLED;
        await appointment.save();

        // Release time slot
        const timeSlot = await this.timeSlotLogModel.findById(timeSlotId);
        if (timeSlot) {
            timeSlot.status = 'available';
            await timeSlot.save();
        }

        // Emit cancel event for wallet refund processing
        this.eventEmitter.emit('appointment.cancelled', {
            appointmentId,
            patientId: appointment.patientId.toString(),
            consultationFee,
            refundAmount,
            reason: reason || 'Appointment cancelled',
            timeSlotId: timeSlotId.toString(),
        });

        console.log(`[AppointmentService] Cancelled appointment ${appointmentId}, refund: ${refundAmount} coins`);

        return {
            code: 'SUCCESS',
            message: 'Appointment cancelled successfully',
            data: {
                appointmentId,
                refundAmount,
            },
        };
    }
}

}