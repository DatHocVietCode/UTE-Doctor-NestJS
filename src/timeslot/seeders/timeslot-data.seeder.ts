import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { TimeSlotData, TimeSlotDataDocument } from '../schemas/timeslot-data.schema';

@Injectable()
export class TimeSlotDataSeeder implements OnModuleInit {
  private readonly logger = new Logger(TimeSlotDataSeeder.name);

  constructor(
    @InjectModel(TimeSlotData.name) private readonly timeSlotDataModel: Model<TimeSlotDataDocument>,
  ) {}

  async onModuleInit() {
    await this.seed();
  }

  async seed() {
    const count = await this.timeSlotDataModel.countDocuments();
    if (count > 0) {
      this.logger.log('TimeSlotData already seeded. Skipping.');
      return;
    }

    const slots = [
      // Buổi sáng (07:30–11:30)
      { start: "07:30", end: "08:30", label: "Ca sáng 1" },
      { start: "08:30", end: "09:30", label: "Ca sáng 2" },
      { start: "09:30", end: "10:30", label: "Ca sáng 3" },
      { start: "10:30", end: "11:30", label: "Ca sáng 4" },

      // Buổi trưa (12:00–15:30)
      { start: "12:00", end: "13:00", label: "Ca trưa 1" },
      { start: "13:00", end: "14:00", label: "Ca trưa 2" },
      { start: "14:00", end: "15:00", label: "Ca trưa 3" },
      { start: "15:00", end: "15:30", label: "Ca trưa 4" },

      // Ngoài giờ (18:00–21:00)
      { start: "18:00", end: "19:00", label: "Ca ngoài giờ 1" },
      { start: "19:00", end: "20:00", label: "Ca ngoài giờ 2" },
      { start: "20:00", end: "21:00", label: "Ca ngoài giờ 3" },
    ];

    await this.timeSlotDataModel.insertMany(slots);
    this.logger.log(`Seeded ${slots.length} TimeSlotData successfully!`);
  }
}
