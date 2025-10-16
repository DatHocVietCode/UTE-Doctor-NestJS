import { Injectable } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { NotificationDocument, Notification } from "./schemas/notification.schema";
import { Model } from "mongoose";
import { InjectModel } from "@nestjs/mongoose";
import { AppointmentBookingDto } from "src/appointment/dto/appointment-booking.dto";

@Injectable()
export class NotificationService {
    constructor(@InjectModel(Notification.name) private notificationModel: Model<NotificationDocument>) {}

    async storeNewNotification(notification: Partial<NotificationDocument>) {
        const newNoti = new this.notificationModel(notification);
        return await newNoti.save();
    }

    async createPatientAppointmentNotification(payload: AppointmentBookingDto) {
        const body = {
            title: 'Đặt lịch khám thành công',
            message: `Bạn đã đặt lịch khám thành công vào ngày ${payload.timeSlotId} tại ${payload.hospitalName}.`,
            details: {
                bacSi: payload.doctor?.name || 'Chưa chọn',
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

    async createDoctorAppointmentNotification(payload: AppointmentBookingDto) {
        const body = {
            title: 'Đặt lịch khám thành công',
            message: `Bạn đã được thêm mới lịch khám vào ngày: ${payload.timeSlotId} tại ${payload.hospitalName}.`,
            details: {
                bacSi: payload.doctor?.name || 'Chưa chọn',
                dichVu: payload.paymentMethod,
                hinhThucThanhToan: payload.paymentMethod,
                amount: payload.amount,
            },
        };

        // Use notiService to st
        await this.storeNewNotification({
            receiverEmail: [payload.doctor!.email!], // chắc chắn có email bác sĩ
            ...body
        });
    }

}

