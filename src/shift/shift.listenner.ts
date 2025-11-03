import { Injectable } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { TimeSlotDto } from "src/timeslot/dtos/timeslot.dto";
import { ShiftService } from "./shift.service";
import { stat } from "fs";
import { TimeSlotStatusEnum } from "src/timeslot/enums/timeslot-status.enum";

@Injectable()
export class ShiftListener {
    constructor(private readonly shiftService : ShiftService) {}

    @OnEvent("doctor.timeslot.query")
    async handleDoctorTimeslotQuery(payload: { doctorId: string; date: string, status: TimeSlotStatusEnum }) : Promise<TimeSlotDto[]> {
        const { doctorId, date, status } = payload;

        const timeSlots = await this.shiftService.findTimeSlotByDoctorAndDate(doctorId, date, status);
        console.log("[ShiftListener] Trả về timeSlots cho doctor.timeslot.query:", timeSlots);
        return timeSlots;
    }
}
