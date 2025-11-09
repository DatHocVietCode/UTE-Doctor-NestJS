import { Injectable } from "@nestjs/common";
import { AppointmentBookingDto } from "./dto/appointment-booking.dto";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { DataResponse } from "src/common/dto/data-respone";
import { ResponseCode } from "src/common/enum/reponse-code.enum";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { Appointment, AppointmentDocument } from "./schemas/appointment.schema";
import { TimeSlotLog } from "src/timeslot/schemas/timeslot-log.schema";

@Injectable()
export class AppointmentService {
    constructor(private readonly eventEmitter: EventEmitter2,
        @InjectModel(Appointment.name) private readonly appointmentModel: Model<Appointment>,
        @InjectModel(TimeSlotLog.name) private readonly timeSlotLogModel: Model<any>, // fallback any for ease

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
            appointmentStatus: 'PENDING', // default
            serviceType: payload.serviceType,
            consultationFee: payload.amount ?? undefined, // nếu amount có thì lưu
            timeSlot: payload.timeSlotId,
            patientId: payload.patientId,
            doctorId: payload.doctor?.id ?? undefined, // nếu null thì bỏ qua
            reasonForAppointment: payload.reasonForAppointment,
            specialtyId: payload.specialty
        });

        console.log('Storing appointment booking information:', appointmentDoc);
        const saved = await appointmentDoc.save();
        return saved;
    }

    async getTodayAppointments(doctorId: string) {
        const today = new Date();
        const formatted = today.toISOString().split("T")[0]; // yyyy-mm-dd

        const appointments: any[] = await this.appointmentModel.find({
            doctorId,
            $expr: {
                $eq: [
                    { $dateToString: { format: "%Y-%m-%d", date: "$date" } },
                    formatted
                ]
            }
        })
        .populate('patientId', 'profileId name phone') // chọn field cần
        .populate('timeSlot', 'start end label shift') // ✅ LẤY start & end
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
                    patient: a.patientId, // thông tin bệnh nhân
                    startTime: timeSlot?.start ?? null, // ✅ LẤY GIỜ BẮT ĐẦU
                    endTime: timeSlot?.end ?? null,     // ✅ LẤY GIỜ KẾT THÚC
                    label: timeSlot?.label ?? null,
                };
            })
        };
    }

}