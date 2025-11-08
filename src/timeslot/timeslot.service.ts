import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { TimeSlotDto } from "./dtos/timeslot.dto";
import { TimeSlotData, TimeSlotDataDocument } from "./schemas/timeslot-data.schema";
import { TimeSlotLog, TimeSlotLogDocument } from "./schemas/timeslot-log.schema";



@Injectable()
export class TimeSlotService {
  constructor(
    @InjectModel(TimeSlotData.name)
    private readonly timeSlotDataModel: Model<TimeSlotDataDocument>,
    @InjectModel(TimeSlotLog.name)
    private readonly timeSlotLogModel: Model<TimeSlotLogDocument>,
  ) {}

  async getAllTimeSlots(): Promise<TimeSlotDto[]> {
    // Lấy tất cả timeslot, sort theo giờ bắt đầu
    const timeSlots = await this.timeSlotDataModel
      .find()
      .sort({ start: 1 })
      .lean();

    // Map sang DTO (đổi _id → id)
    return timeSlots.map(slot => ({
      id: slot._id.toString(),
      start: slot.start,
      end: slot.end,
      label: slot.label,
    }));
  }

  async getTimeSlotNameById(id: string) : Promise<string> {
    const timeslot = await this.timeSlotLogModel.findById(id).lean();
    let timeSlotName = '';
    if (timeslot) {
      timeSlotName = `${timeslot.start} - ${timeslot.end}`;
    }
    return timeSlotName;
  }
  
}
