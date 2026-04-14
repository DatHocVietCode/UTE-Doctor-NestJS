import { Injectable, NotFoundException } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { AppointmentEnriched } from "src/appointment/schemas/appointment-enriched";
import { PaginationQueryDto } from "src/common/dto/pagination-query.dto";
import { PaginationResult } from "src/common/dto/pagination-result.dto";
import { emitTyped } from "src/utils/helpers/event.helper";
import { Notification, NotificationDocument } from "./schemas/notification.schema";

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

    async getNotifications(
        pagination: PaginationQueryDto
        ): Promise<PaginationResult<Notification>> {
        const { page, limit } = pagination;

        const skip = (page - 1) * limit;

        const [data, total] = await Promise.all([
            this.notificationModel
            .find()
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),

            this.notificationModel.countDocuments(),
        ]);

        return new PaginationResult(data, total, page, limit);
    }
    async getNotificationsByEmail(
        email: string,
        pagination: PaginationQueryDto
        ): Promise<PaginationResult<Notification>> {

        const { page, limit } = pagination;
        const skip = (page - 1) * limit;

        const filter = {
            $or: [
            { isBroadcast: true },
            { receiverEmail: email },
            ],
        };

        const [data, total] = await Promise.all([
            this.notificationModel
            .find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),

            this.notificationModel.countDocuments(filter),
        ]);

        return new PaginationResult(data, total, page, limit);
    }

    async countUnreadByEmail(email: string): Promise<number> {
        if (!email) throw new Error('[NotificationService] Email is required');

        return this.notificationModel.countDocuments({
        receiverEmail: email,
        isRead: false,
        });
    }

    async markAsRead(id: string): Promise<Notification> {
        const notif = await this.notificationModel.findByIdAndUpdate(
            id,
            { isRead: true },
            { new: true }
        ).lean();

        if (!notif) throw new NotFoundException('[NotificationService] Notification not found');
        return notif;
    }

    async createPatientShiftCancellationNotification(payload: {
        patientEmail: string;
        doctorName?: string;
        date: string;
        timeSlot: string;
        hospitalName?: string;
        reason?: string;
    }) {
        const timeSlotName = await emitTyped<string, string>(
            this.eventEmitter,
            'timeslot.get.name.by.id',
            payload.timeSlot
        );

        const title = 'Thông báo hủy ca khám';
        const message = `Ca khám ngày ${payload.date} lúc ${timeSlotName}${payload.hospitalName ? ` tại ${payload.hospitalName}` : ''} đã bị hủy${payload.doctorName ? ` bởi bác sĩ ${payload.doctorName}` : ''}${payload.reason ? `. Lý do: ${payload.reason}` : ''}. Vui lòng đặt lại lịch hoặc liên hệ hỗ trợ.`;

        await this.storeNewNotification({
            receiverEmail: [payload.patientEmail],
            title,
            message,
        });
    }

    async createDoctorShiftCancellationNotification(payload: {
        doctorEmail: string;
        date: string;
        shift: string;
        reason?: string;
        affectedAppointmentsCount: number;
    }) {
        const title = 'Xác nhận hủy ca trực';
        const message = `Bạn đã hủy ca ${payload.shift === 'morning' ? 'sáng' : payload.shift === 'afternoon' ? 'trưa' : 'ngoài giờ'} ngày ${payload.date}${payload.reason ? `. Lý do: ${payload.reason}` : ''}. Có ${payload.affectedAppointmentsCount} lịch hẹn bị ảnh hưởng. Bệnh nhân đã được thông báo và hoàn coin.`;

        await this.storeNewNotification({
            receiverEmail: [payload.doctorEmail],
            title,
            message,
        });
    }

    async createPatientAppointmentCancellationNotification(payload: {
        patientEmail: string;
        doctorName?: string;
        date: string;
        timeSlot: string;
        hospitalName?: string;
        reason?: string;
    }) {
        const timeSlotName = await emitTyped<string, string>(
            this.eventEmitter,
            'timeslot.get.name.by.id',
            payload.timeSlot
        );

        const title = 'Thông báo hủy lịch khám';
        const message = `Lịch khám ngày ${payload.date} lúc ${timeSlotName}${payload.hospitalName ? ` tại ${payload.hospitalName}` : ''} đã bị hủy${payload.doctorName ? ` bởi bác sĩ ${payload.doctorName}` : ''}${payload.reason ? `. Lý do: ${payload.reason}` : ''}.`; 

        await this.storeNewNotification({
            receiverEmail: [payload.patientEmail],
            title,
            message,
        });
    }
}

