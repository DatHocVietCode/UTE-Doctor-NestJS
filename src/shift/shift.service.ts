import { Injectable } from "@nestjs/common";
import { EventEmitter2, OnEvent } from "@nestjs/event-emitter";
import { InjectModel } from "@nestjs/mongoose";
import { Model, Types } from "mongoose";
import { AppointmentBookingDto } from "src/appointment/dto/appointment-booking.dto";
import { DataResponse } from "src/common/dto/data-respone";
import { ResponseCode as rc } from "src/common/enum/reponse-code.enum";
import { TimeSlotDto } from "src/timeslot/dtos/timeslot.dto";
import { TimeSlotStatusEnum } from "src/timeslot/enums/timeslot-status.enum";
import { TimeSlotData } from "src/timeslot/schemas/timeslot-data.schema";
import { TimeSlotLog } from "src/timeslot/schemas/timeslot-log.schema";
import { emitTyped } from "src/utils/helpers/event.helper";
import { RegisterShiftDto } from "./dto/register-shift.dto";
import { ShiftStatusEnum } from "./enums/shift-status.enum";
import { Shift } from "./schema/shift.schema";

@Injectable()
export class ShiftService {
  constructor(
    private readonly eventEmitter: EventEmitter2,
    @InjectModel(Shift.name) private readonly shiftModel: Model<Shift>,
    @InjectModel(TimeSlotLog.name) private readonly timeSlotLogModel: Model<TimeSlotLog>,
    @InjectModel(TimeSlotData.name) private readonly timeSlotDataModel: Model<TimeSlotData>
  ) {}

  async registerShift(dto: RegisterShiftDto): Promise<DataResponse> {
    console.log("📩 [ShiftService] Nhận yêu cầu đăng ký ca:", dto);

    try {
      const results = await this.eventEmitter.emitAsync("shift.register.requested", dto);
      
      console.log("📦 [ShiftService] Raw results from Saga:", results);
      console.log("📦 [ShiftService] Results length:", results?.length);
      console.log("📦 [ShiftService] First result:", results?.[0]);

      // Chờ Promise nếu kết quả là Promise
      let response = results?.[0];
      if (response instanceof Promise) {
        console.log("⏳ [ShiftService] Đang await Promise...");
        response = await response;
      }

      console.log("✅ [ShiftService] Final response:", response);

      if (!response || typeof response !== 'object' || !response.code) {
        console.error("❌ [ShiftService] Invalid response from Saga");
        return {
          code: rc.ERROR,
          message: "Không có phản hồi hợp lệ từ Saga.",
          data: null,
        };
      }

      return response as DataResponse;
    } catch (error) {
      console.error("❌ [ShiftService] Error in registerShift:", error);
      return {
        code: rc.ERROR,
        message: error.message || "Unexpected error",
        data: null,
      };
    }
  }

  @OnEvent("shift.check.duplicate")
  async handleCheckDuplicate(payload: {
    doctorId: string;
    date: string;
    shift: string;
  }): Promise<boolean> {
    console.log(
      `[ShiftService] 🔍 Bắt đầu kiểm tra trùng ca:`,
      payload
    );

    try {
      const exists = await this.shiftModel
        .exists({
          doctorId: payload.doctorId,
          date: payload.date,
          shift: payload.shift,
        })
        .exec();

      const isDuplicate = !!exists;
      
      console.log(
        `[ShiftService] ✅ Kết quả kiểm tra trùng ca → ${isDuplicate}`
      );

      return isDuplicate;
    } catch (error) {
      console.error("[ShiftService] ❌ Lỗi khi kiểm tra trùng ca:", error.message);
      return false;
    }
  }

  /**
   * Lấy danh sách TimeSlotData theo shift type
   */
  private async getTimeSlotDataByShift(shiftType: "morning" | "afternoon" | "extra"): Promise<TimeSlotData[]> {
    console.log(`[ShiftService] 🔍 Lấy TimeSlotData cho shift: ${shiftType}`);

    try {
      let query: any = {};

      // Lọc theo shift type dựa vào label
      if (shiftType === "morning") {
        query.label = { $regex: /^Ca sáng/i };
      } else if (shiftType === "afternoon") {
        query.label = { $regex: /^Ca trưa/i };
      } else if (shiftType === "extra") {
        query.label = { $regex: /^Ca ngoài giờ/i };
      }

      const timeSlotData = await this.timeSlotDataModel
        .find(query)
        .sort({ start: 1 }) // Sắp xếp theo thời gian bắt đầu
        .lean()
        .exec();

      console.log(`[ShiftService] ✅ Tìm thấy ${timeSlotData.length} TimeSlotData cho shift ${shiftType}`);
      
      return timeSlotData;
    } catch (error) {
      console.error("[ShiftService] ❌ Lỗi khi lấy TimeSlotData:", error.message);
      return [];
    }
  }

  /**
   * Tạo TimeSlotLog từ TimeSlotData
   */
  private async createTimeSlotLogsFromData(timeSlotDataList: TimeSlotData[]): Promise<any[]> {
    console.log(`[ShiftService] 📝 Tạo ${timeSlotDataList.length} TimeSlotLog từ TimeSlotData`);
    try {
      if (!Array.isArray(timeSlotDataList) || timeSlotDataList.length === 0) return [];

      const docsToCreate = timeSlotDataList.map((d) => {
        // đảm bảo lấy _id từ document Mongoose; nếu có property id dùng fallback qua any
        const timeSlotDataId = (d as any)._id ?? (d as any).id ?? undefined;

        return {
          timeSlotData: timeSlotDataId,
          shift: d.shift,
          start: d.start,
          end: d.end,
          label: d.label,
          status: "available",
        };
      });

      // Sử dụng insertMany để tạo nhanh nhiều bản ghi và nhận _id
      const created = await this.timeSlotLogModel.insertMany(docsToCreate, { ordered: true });

      console.log(`[ShiftService] ✅ Đã tạo ${created.length} TimeSlotLog`);
      return Array.isArray(created) ? created : [];
    } catch (error) {
      console.error("[ShiftService] ❌ Lỗi khi tạo TimeSlotLog từ TimeSlotData:", error?.message ?? error);
      return [];
    }
  }

  /**
   * Event listener để saga yêu cầu tạo TimeSlotLog từ TimeSlotData
   * Trả về array các TimeSlotLog đã tạo (có _id)
   */
  @OnEvent("timeslot.log.create.from.data")
  async handleCreateTimeSlotLogsFromData(event: { timeSlotDataList: TimeSlotData[] }): Promise<any[]> {
    console.log("[ShiftService] 🔁 Received event timeslot.log.create.from.data", {
      count: event?.timeSlotDataList?.length ?? 0,
    });
    try {
      const created = await this.createTimeSlotLogsFromData(event.timeSlotDataList ?? []);
      console.log(`[ShiftService] ✅ Returning ${created?.length ?? 0} created TimeSlotLogs`);
      return Array.isArray(created) ? created : [];
    } catch (error) {
      console.error("[ShiftService] ❌ Error in handleCreateTimeSlotLogsFromData:", error?.message ?? error);
      return [];
    }
  }

  @OnEvent("shift.create.requested")
  async handleCreateShift(event: { dto: RegisterShiftDto }): Promise<any> {
    const { dto } = event;
    console.log("🟢 [ShiftService] Nhận yêu cầu tạo ca:", dto);

    try {
      // 1️⃣ Lấy TimeSlotData tương ứng với shift type
      const timeSlotDataList = await this.getTimeSlotDataByShift(dto.shift);

      if (timeSlotDataList.length === 0) {
        throw new Error(`Không tìm thấy TimeSlotData cho shift: ${dto.shift}`);
      }

      // 2️⃣ Tạo các TimeSlotLog từ TimeSlotData
      const timeSlotLogs = await this.createTimeSlotLogsFromData(timeSlotDataList);

      // 3️⃣ Lấy danh sách ID của TimeSlotLog
      const timeSlotIds = timeSlotLogs.map(log => log._id);

      // 4️⃣ Tạo Shift với các TimeSlot đã tạo
      const shiftData: any = {
        doctorId: dto.doctorId,
        date: dto.date,
        shift: dto.shift,
        status: "available",
        timeSlots: timeSlotIds, // Gán danh sách TimeSlot ID
      };

      const newShift = new this.shiftModel(shiftData);
      const savedShift = await newShift.save();
      
      console.log("✅ [ShiftService] Lưu ca thành công:", savedShift._id.toString());
      console.log(`✅ [ShiftService] Đã gán ${timeSlotIds.length} TimeSlot vào shift`);
      
      const result: any = savedShift.toObject();
      result.timeSlotDetails = timeSlotLogs;
      
      return result;
    } catch (error) {
      console.error("❌ [ShiftService] Lỗi khi tạo shift:", error.message);
      throw error;
    }
  }

  async getShiftsByMonth(
    doctorId: string,
    month: string,
    year: string,
    status?: string
  ): Promise<DataResponse> {
    console.log("📩 [ShiftService] Lấy ca theo tháng:", { doctorId, month, year, status });

    try {
      // Validate input
      const monthNum = parseInt(month);
      const yearNum = parseInt(year);

      if (monthNum < 1 || monthNum > 12) {
        return {
          code: rc.ERROR,
          message: "Tháng không hợp lệ (phải từ 1-12)",
          data: null,
        };
      }

      if (yearNum < 2000 || yearNum > 2100) {
        return {
          code: rc.ERROR,
          message: "Năm không hợp lệ",
          data: null,
        };
      }

      // Tính ngày đầu và cuối tháng
      const startDate = `${year}-${month.padStart(2, '0')}-01`;
      
      // Lấy ngày cuối tháng
      const lastDay = new Date(yearNum, monthNum, 0).getDate();
      const endDate = `${year}-${month.padStart(2, '0')}-${lastDay}`;

      console.log("🔍 [ShiftService] Date range:", { startDate, endDate });

      // Build query filter
      const filter: any = {
        doctorId,
        date: { $gte: startDate, $lte: endDate }
      };

      if (status) {
        filter.status = status;
      }

      console.log("🔍 [ShiftService] Query filter:", filter);

 
      // Lấy danh sách ca và populate TimeSlotLog
      const shifts = await this.shiftModel
        .find(filter)
        .sort({ date: 1, shift: 1 })
        .populate('timeSlots') // Populate thông tin TimeSlot
        .lean()
        .exec();

      console.log(`✅ [ShiftService] Tìm thấy ${shifts.length} ca trong tháng ${month}/${year}`);

      // Nhóm theo ngày để dễ hiển thị
      const groupedByDate = shifts.reduce((acc, shift) => {
        const date = shift.date;
        if (!acc[date]) {
          acc[date] = [];
        }
        acc[date].push(shift);
        return acc;
      }, {});

      // Thống kê
      const statistics = {
        totalShifts: shifts.length,
        available: shifts.filter(s => s.status === 'available').length,
        hasClient: shifts.filter(s => s.status === 'hasClient').length,
        completed: shifts.filter(s => s.status === 'completed').length,
        canceled: shifts.filter(s => s.status === 'canceled').length,
      };

      return {
        code: rc.SUCCESS,
        message: `Lấy danh sách ca tháng ${month}/${year} thành công`,
        data: {
          month: monthNum,
          year: yearNum,
          statistics,
          shifts,
          groupedByDate, // Nhóm theo ngày
        },
      };
    } catch (error) {
      console.error("❌ [ShiftService] Lỗi khi lấy ca theo tháng:", error.message);
      return {
        code: rc.ERROR,
        message: error.message || "Lỗi khi lấy danh sách ca",
        data: null,
      };
    }
  }

  async deleteShiftById(id: string): Promise<DataResponse> {
    console.log("🗑️ [ShiftService] Yêu cầu xóa ca:", id);

    try {
      const shift = await this.shiftModel.findById(id).exec();

      if (!shift) {
        return {
          code: rc.ERROR,
          message: "Không tìm thấy ca để xóa.",
          data: null,
        };
      }

      // Xóa tất cả TimeSlotLog liên quan
      if (shift.timeSlots && shift.timeSlots.length > 0) {
        await this.timeSlotLogModel.deleteMany({
          _id: { $in: shift.timeSlots }
        }).exec();
        console.log(`🗑️ [ShiftService] Đã xóa ${shift.timeSlots.length} TimeSlotLog`);
      }

      // Xóa Shift
      await this.shiftModel.findByIdAndDelete(id).exec();

      console.log("✅ [ShiftService] Đã xóa ca thành công:", id);

      return {
        code: rc.SUCCESS,
        message: "Xóa ca thành công.",
        data: shift.toObject(),
      };
    } catch (error) {
      console.error("❌ [ShiftService] Lỗi khi xóa ca:", error.message);
      return {
        code: rc.ERROR,
        message: error.message || "Lỗi khi xóa ca.",
        data: null,
      };
    }
  }

  async cancelShiftById(id: string, reason: string): Promise<DataResponse> {
    console.log("[ShiftService] Yêu cầu hủy ca:", id, "Lý do:", reason);
    try {
      const shift = await this.shiftModel.findById(id).exec();

      if (!shift) {
        return {
          code: rc.ERROR,
          message: "Không tìm thấy ca để hủy.",
          data: null,
        };
      }

      if (shift.status !== "hasClient") {
        return {
          code: rc.ERROR,
          message: `Không thể hủy ca. Trạng thái hiện tại là "${shift.status}".`,
          data: shift.toObject(),
        };
      }

      shift.status = ShiftStatusEnum.CANCELED;
      shift.reasonForCancellation = reason;
      await shift.save();

      // Cập nhật tất cả TimeSlotLog liên quan thành 'canceled'
      if (shift.timeSlots && shift.timeSlots.length > 0) {
        await this.timeSlotLogModel.updateMany(
          { _id: { $in: shift.timeSlots } },
          { $set: { status: 'canceled' } }
        ).exec();
        console.log(`[ShiftService] Đã cập nhật ${shift.timeSlots.length} TimeSlotLog thành canceled`);
      }

      console.log("[ShiftService] Đã hủy ca thành công:", shift._id.toString());

      return {
        code: rc.SUCCESS,
        message: "Hủy ca thành công.",
        data: shift.toObject(),
      };
    } catch (error) {
      console.error("[ShiftService] Lỗi khi hủy ca:", error.message);
      return {
        code: rc.ERROR,
        message: error.message || "Lỗi khi hủy ca.",
        data: null,
      };
    }
  }


  async findTimeSlotByDoctorAndDate(doctorId: string, date: string, 
    status: TimeSlotStatusEnum): Promise<TimeSlotDto[]> 
    {
      let res : TimeSlotDto[];
      if (!doctorId || doctorId.trim() === "") {
        // ✅ Nếu không có doctorId, trả về toàn bộ timeslot từ timeslotData
        res = await emitTyped<{}, TimeSlotDto[]>(
          this.eventEmitter,
          "timeslot.get.all",
          {}
        );
       
      }
      else
      {
        console.log("[ShiftService] Tìm TimeSlots cho bác sĩ:", doctorId, "ngày:", date, "với status:", status);
         // ✅ Nếu có doctorId, lấy shift của bác sĩ theo ngày, lấy từ timeslotLog
        res = await this.getTimeSlotsByDoctorAndDate(doctorId, date, status);
      }
      return Array.isArray(res) ? res : [];
  }

  @OnEvent("timeslot.data.get.by.shift")
  async handleGetTimeSlotDataByShift(payload: { shift: "morning" | "afternoon" | "extra" }): Promise<TimeSlotData[]> {
    console.log(`[ShiftService] 🔁 Received event timeslot.data.get.by.shift`, payload);
    try {
      const timeSlotData = await this.getTimeSlotDataByShift(payload.shift);
      console.log(`[ShiftService] ✅ Returning ${timeSlotData?.length ?? 0} TimeSlotData for shift ${payload.shift}`);
      return Array.isArray(timeSlotData) ? timeSlotData : [];
    } catch (error) {
      console.error("[ShiftService] ❌ Error in handleGetTimeSlotDataByShift:", error?.message ?? error);
      return [];
    }
  }

  async getTimeSlotsByDoctorAndDate(
      doctorId: string, 
      date: string,
      status: TimeSlotStatusEnum
    ) : Promise<TimeSlotDto[]> {
      const query: any = { doctorId, date };

      console.log("[ShiftService] Lấy TimeSlots cho bác sĩ:", doctorId, "ngày:", date, "với filter:", query, "và status:", status);

      const shifts = await this.shiftModel
        .find(query)
        .populate({
          path: 'timeSlots',
          match: status ? { status } : {}, // filter chỉ những timeSlot có status
        })
        .exec();

      console.log(`[ShiftService] Tìm thấy ${shifts.length} ca cho bác sĩ ${doctorId} vào ngày ${date} với shift ${shifts.map(s => s.shift).join(", ")}`);

      const slots = shifts.flatMap(s => s.timeSlots).map((slot: any) => ({
        id: slot._id.toString(),
        start: slot.start,
        end: slot.end,
        label: slot.label,
    }));

    return slots;

    }
  
  async handleDoctorUpdateSchedule(payload: AppointmentBookingDto): Promise<boolean> {
    try {
      const { doctor, date, timeSlotId } = payload;
      const doctorId = doctor?.id;
      const dateOnly = new Date(date).toISOString().split("T")[0];

      // 1️⃣ Tìm tất cả shift của bác sĩ trong ngày đó
      const shifts = await this.shiftModel
        .find({ doctorId, date: dateOnly })
        .populate("timeSlots")
        .exec();

      if (!shifts || shifts.length === 0) {
        console.warn(`[ShiftService] Không tìm thấy shift nào cho bác sĩ ${doctorId} vào ngày ${dateOnly}`);
        return false;
      }

      // 2️⃣ Duyệt toàn bộ shift để tìm timeslot trùng
      let targetShift: any = null;
      let targetSlot: any = null;

      for (const shift of shifts) {
        const foundSlot = shift.timeSlots.find(
          (slot: any) => slot._id.toString() === timeSlotId
        );
        if (foundSlot) {
          targetShift = shift;
          targetSlot = foundSlot;
          break;
        }
      }

      if (!targetSlot || !targetShift) {
        console.warn(`[ShiftService] Không tìm thấy TimeSlot ${timeSlotId} trong bất kỳ shift nào của bác sĩ ${doctorId}`);
        return false;
      }

      console.log(`[ShiftService] Đã tìm thấy shift ${targetShift._id} chứa TimeSlot ${timeSlotId}`);

      // 3️⃣ Update status của timeslot
      const updatedSlot = await this.timeSlotLogModel.updateOne(
        { _id: targetSlot._id },
        { $set: { status: TimeSlotStatusEnum.BOOKED } }
      );

      if (updatedSlot.modifiedCount === 0) {
        console.warn(`[ShiftService] Cập nhật TimeSlot ${timeSlotId} thất bại.`);
        return false;
      }

      console.log(`[ShiftService] TimeSlot ${timeSlotId} cập nhật sang BOOKED thành công.`);

      // 4️⃣ Cập nhật shift sang HAS_CLIENT (nếu chưa có)
      await this.shiftModel.updateOne(
        { _id: targetShift._id },
        { $set: { status: ShiftStatusEnum.HAS_CLIENT } }
      );

      console.log(`[ShiftService] Shift ${targetShift._id} cập nhật sang HAS_CLIENT thành công.`);
      return true;

    } catch (error) {
      console.error("[ShiftService] Lỗi khi xử lý doctor.update-schedule:", error);
      return false;
    }
  }

}