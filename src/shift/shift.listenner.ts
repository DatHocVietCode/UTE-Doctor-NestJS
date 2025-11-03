import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Shift } from "./schema/shift.schema";
import { Model } from "mongoose";
import { OnEvent } from "@nestjs/event-emitter";

@Injectable()
export class ShiftListener {
    constructor(@InjectModel(Shift.name) private shiftModel: Model<Shift>) {}

    @OnEvent("doctor.timeslot.query", { async: true })
    async handleDoctorTimeslotQuery(payload: { doctorId: string; date: string }) {
        const { doctorId, date } = payload;

        // ✅ Lấy danh sách shift còn trống của bác sĩ theo ngày
        const shifts = await this.shiftModel
        .find({ doctorId, date, status: "available" }) // chỉ lấy shift còn trống
        .populate("timeSlotId")
        .exec();

        // ✅ Lấy ra danh sách timeslot (mỗi shift ứng với 1 timeslot)
        const slots = shifts
        .filter(s => s.timeSlotId) // tránh trường hợp populate lỗi
        .map(s => s.timeSlotId);

        return { data: slots };
    }
}
