import { OnEvent } from "@nestjs/event-emitter";
import { TimeSlotService } from "./timeslot.service";
import { Inject, Injectable } from "@nestjs/common";
import { TimeSlotDto } from "./dtos/timeslot.dto";

@Injectable()
export class TimeSlotListener {
    constructor(private readonly timeSlotService: TimeSlotService) {}

    @OnEvent('timeslot.get.name.by.id')
    async handleGetTimeSlotNameByIdEvent(payload: string): Promise<string> {
        return await this.timeSlotService.getTimeSlotNameById(payload);
    }
    
    @OnEvent("timeslot.get.all")
    async handleGetAllTimeSlotsEvent(): Promise<TimeSlotDto[]> {
        const slots = await this.timeSlotService.getAllTimeSlots();
        return slots.map((slot) => ({
            id: slot.id.toString(),
            start: slot.start,
            end: slot.end,
            label: slot.label,
        }));
    }
    
}