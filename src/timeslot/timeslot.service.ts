import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { TimeSlot, TimeSlotDocument } from "./timeslot.schema";

@Injectable()
export class TimeSlotService {
  constructor(
    @InjectModel(TimeSlot.name)
    private readonly timeSlotModel: Model<TimeSlotDocument>,
  ) {}

  async getAllTimeSlots() {
    // Truy vấn tất cả timeslot, sắp xếp theo giờ bắt đầu
    return this.timeSlotModel.find().sort({ start: 1 }).lean();
  }

  async getTimeSlotNameById(id: string) {
    const timeslot = await this.timeSlotModel.findById(id).lean();
    let timeSlotName = '';
    if (timeslot) {
      timeSlotName = `${timeslot.start} - ${timeslot.end}`;
    }
    return timeSlotName;
  }
}
