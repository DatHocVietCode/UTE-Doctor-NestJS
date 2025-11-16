import { Injectable } from "@nestjs/common";
import { EventEmitter2, OnEvent } from "@nestjs/event-emitter";
import { NotificationDocument, Notification } from "./schemas/notification.schema";
import { Model } from "mongoose";
import { InjectModel } from "@nestjs/mongoose";
import { AppointmentBookingDto } from "src/appointment/dto/appointment-booking.dto";
import { emitTyped } from "src/utils/helpers/event.helper";
import { AppointmentDocument } from "src/appointment/schemas/appointment.schema";
import { AppointmentEnriched } from "src/appointment/schemas/appointment-enriched";

@Injectable()
export class NotificationService {
    constructor(@InjectModel(Notification.name) private notificationModel: Model<NotificationDocument>
                ,private readonly eventEmitter: EventEmitter2) {}

    async storeNewNotification(notification: Partial<NotificationDocument>) {
        const newNoti = new this.notificationModel(notification);
        return await newNoti.save();
    }

    async createPatientAppointmentNotification(payload: AppointmentEnriched) {
        let timeSlotName = '';
        timeSlotName = await emitTyped<string, string>(
            this.eventEmitter,
            'timeslot.get.name.by.id',
            payload.timeSlot.toString()
        );
        const body = {
            title: 'Đặt lịch khám thành công',
            message: `Bạn đã đặt lịch khám thành công vào ngày ${payload.date} lúc ${timeSlotName} tại ${payload.hospitalName}.`,
            details: {
                bacSi: payload.doctorName || 'Chưa chọn',
                dichVu: payload.serviceType,
                hinhThucThanhToan: payload.paymentMethod,
                amount: payload.amount,
            },
        };

        // Use notiService to st
        await this.storeNewNotification({
            receiverEmail: [payload.patientEmail],
            ...body
        });
    }

    async createDoctorAppointmentNotification(payload: AppointmentEnriched) {
        const timeSlotName = await emitTyped<string, string>(
            this.eventEmitter,
            'timeslot.get.name.by.id',
            payload.timeSlot._id.toString()!
        );
        const body = {
            title: 'Đặt lịch khám thành công',
            message: `Bạn đã được thêm mới lịch khám vào ngày: ${payload.date} lúc ${timeSlotName} tại ${payload.hospitalName}.`,
            details: {
                bacSi: payload.doctorName || 'Chưa chọn',
                dichVu: payload.paymentMethod,
                hinhThucThanhToan: payload.paymentMethod,
                thoiGian: "Ngày: " + payload.date + " lúc " +  timeSlotName,
                amount: payload.amount,
            },
        };

        // Use notiService to st
        await this.storeNewNotification({
            receiverEmail: [payload.doctorEmail!], // chắc chắn có email bác sĩ
            ...body
        });
    }

}

