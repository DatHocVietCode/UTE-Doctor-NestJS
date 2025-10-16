import { Controller, Get } from "@nestjs/common";
import { DataResponse } from "src/common/dto/data-respone";
import { ResponseCode } from "src/common/enum/reponse-code.enum";
import { TimeSlotService } from "./timeslot.service";

@Controller("timeslot")
export class TimeSlotController {
    constructor(private timeslotService: TimeSlotService) {}
  // TimeSlotController implementation goes here
    @Get("")
    async getTimeSlots() {
        const res : DataResponse = { 
            code: ResponseCode.SUCCESS,
            message: "Lấy danh sách khung giờ thành công", 
            data: await this.timeslotService.getAllTimeSlots()
        }
        return res;
    }
}