import { OnEvent } from "@nestjs/event-emitter";
import { TimeSlotService } from "./timeslot.service";
import { Inject, Injectable } from "@nestjs/common";

@Injectable()
export class TimeSlotListener {
    constructor(private readonly timeSlotService: TimeSlotService) {}

    @OnEvent('timeslot.get.name.by.id')
    async handleGetTimeSlotNameByIdEvent(payload: string): Promise<string> {
        return await this.timeSlotService.getTimeSlotNameById(payload);
    }
}