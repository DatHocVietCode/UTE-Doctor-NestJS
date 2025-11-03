import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
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

  async getAllTimeSlots() : Promise<TimeSlotLog[]> {
    // Truy vấn tất cả timeslot, sắp xếp theo giờ bắt đầu
    return this.timeSlotLogModel.find().sort({ start: 1 }).lean<TimeSlotLog[]>();
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
