import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Shift } from "./schema/shift.schema";
import { Model } from "mongoose";
import { OnEvent } from "@nestjs/event-emitter";
import { ShiftService } from "./shift.service";
import { TimeSlotDto } from "src/timeslot/dtos/timeslot.dto";

@Injectable()
export class ShiftListener {
    constructor(private readonly shiftService : ShiftService) {}

    @OnEvent("doctor.timeslot.query", { async: true })
    async handleDoctorTimeslotQuery(payload: { doctorId: string; date: string }) : Promise<TimeSlotDto[]> {
        const { doctorId, date } = payload;

        const timeSlots = await this.shiftService.findShiftsByDoctorAndDate(doctorId, date);

        return timeSlots.map(slot => ({
            id: slot._id.toString(),
            start: slot.start,
            end: slot.end,
            label: slot.label
        }));
    }
}
