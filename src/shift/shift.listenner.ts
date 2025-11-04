import { Injectable } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { TimeSlotDto } from "src/timeslot/dtos/timeslot.dto";
import { ShiftService } from "./shift.service";
import { stat } from "fs";
import { TimeSlotStatusEnum } from "src/timeslot/enums/timeslot-status.enum";
import { AppointmentBookingDto } from "src/appointment/dto/appointment-booking.dto";

@Injectable()
export class ShiftListener {
    constructor(private readonly shiftService : ShiftService) {}

    @OnEvent("doctor.timeslot.query")
    async handleDoctorTimeslotQuery(payload: { doctorId: string; date: string, status: TimeSlotStatusEnum }) : Promise<TimeSlotDto[]> {
        const { doctorId, date, status } = payload;

        console.log("[ShiftListener] Get status:", status, "for doctorId:", doctorId, "on date:", date);

        const timeSlots = await this.shiftService.findTimeSlotByDoctorAndDate(doctorId, date, status);
        console.log("[ShiftListener] Trả về timeSlots cho doctor.timeslot.query:", timeSlots);
        return timeSlots;
    }

    @OnEvent("doctor.update-schedule")
    async handleDoctorUpdateSchedule(payload: AppointmentBookingDto) {
        console.log("[ShiftListener] Nhận sự kiện doctor.update-schedule với payload:", payload);
        const isUpdated: boolean = await this.shiftService.updateTimeSlotStatus(payload.timeSlotId, TimeSlotStatusEnum.BOOKED);
        if (isUpdated) {
            console.log(`[ShiftListener] Cập nhật trạng thái TimeSlot ${payload.timeSlotId} thành BOOKED thành công.`);
        } else {
            console.log(`[ShiftListener] Cập nhật trạng thái TimeSlot ${payload.timeSlotId} thành BOOKED thất bại.`);
        }
    }
}
