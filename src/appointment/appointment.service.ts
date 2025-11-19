import { Injectable, NotFoundException } from "@nestjs/common";
import { AppointmentBookingDto, CompleteAppointmentDto } from "./dto/appointment-booking.dto";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { DataResponse } from "src/common/dto/data-respone";
import { ResponseCode } from "src/common/enum/reponse-code.enum";
import { InjectModel } from "@nestjs/mongoose";
import { Model, Types } from "mongoose";
import { Appointment, AppointmentDocument } from "./schemas/appointment.schema";
import { AppointmentStatus } from "./enums/Appointment-status.enum";
import { TimeSlotLog, TimeSlotLogDocument } from "src/timeslot/schemas/timeslot-log.schema";
import { Patient, PatientDocument } from "src/patient/schema/patient.schema";
import { MedicalRecordDescription } from "src/patient/schema/medical-record.schema";
import { Medicine, MedicineDocument } from "src/medicine/schema/medicine.schema";

@Injectable()
export class AppointmentService {
    constructor(private readonly eventEmitter: EventEmitter2,
        @InjectModel(Appointment.name) private readonly appointmentModel: Model<Appointment>,
        @InjectModel(TimeSlotLog.name) private readonly timeSlotLogModel: Model<TimeSlotLogDocument>,
        @InjectModel(Patient.name) private readonly patientModel: Model<PatientDocument>,
        @InjectModel(Medicine.name) private readonly medicineModel: Model<MedicineDocument>,
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

    // Push the new record onto the document and save so Mongoose will cast subdocuments correctly
    patient.medicalRecord.medicalHistory = patient.medicalRecord.medicalHistory || [];
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

}