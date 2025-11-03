import { Injectable } from "@nestjs/common";
import { EventEmitter2, OnEvent } from "@nestjs/event-emitter";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { RegisterShiftDto } from "./dto/register-shift.dto";
import { Shift, ShiftDocument } from "./schema/shift.schema";
import { DataResponse } from "src/common/dto/data-respone";
import { ResponseCode as rc } from "src/common/enum/reponse-code.enum";
import { emitTyped } from "src/utils/helpers/event.helper";
import { TimeSlotDto } from "src/timeslot/dtos/timeslot.dto";
import { TimeSlot } from "src/timeslot/timeslot.schema";

@Injectable()
export class ShiftService {
  constructor(
    private readonly eventEmitter: EventEmitter2,
    @InjectModel(Shift.name) private readonly shiftModel: Model<Shift>
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

      // QUAN TRỌNG: Return ngay lập tức
      return isDuplicate;
    } catch (error) {
      console.error("[ShiftService] ❌ Lỗi khi kiểm tra trùng ca:", error.message);
      return false;
    }
  }

  @OnEvent("shift.create.requested")
  async handleCreateShift(event: { dto: RegisterShiftDto }): Promise<any> {
    const { dto } = event;
    console.log("🟢 [ShiftService] Nhận yêu cầu tạo ca:", dto);

    const shiftData: any = {
      doctorId: dto.doctorId,
      date: dto.date,
      shift: dto.shift,
      status: "available",
    };

    const newShift = new this.shiftModel(shiftData);
    const savedShift = await newShift.save();
    
    console.log("✅ [ShiftService] Lưu ca thành công:", savedShift._id.toString());
    
    // Trả về plain object, không phải Mongoose document
    return savedShift.toObject();
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

      // Lấy danh sách ca
      const shifts = await this.shiftModel
        .find(filter)
        .sort({ date: 1, shift: 1 }) // Sắp xếp theo ngày và ca
        // .populate('patientId', 'name phone email') // Populate thông tin bệnh nhân
        .lean() // Convert sang plain object
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
      const deleted = await this.shiftModel.findByIdAndDelete(id).exec();

      if (!deleted) {
        return {
          code: rc.ERROR,
          message: "Không tìm thấy ca để xóa.",
          data: null,
        };
      }

      console.log("✅ [ShiftService] Đã xóa ca thành công:", deleted._id.toString());

      return {
        code: rc.SUCCESS,
        message: "Xóa ca thành công.",
        data: deleted.toObject(),
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

      shift.status = "canceled";
      shift.reasonForCancellation = reason;
      await shift.save();

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

  async findShiftsByDoctorAndDate(doctorId: string, date: string): Promise<TimeSlot[]> {
    let res : TimeSlot[];
    if (!doctorId || doctorId.trim() === "") {
    
      // ✅ Nếu không có doctorId, trả về toàn bộ timeslot
      res = await emitTyped<{}, TimeSlot[]>(
        this.eventEmitter,
        "timeslot.get.all",
        {}
      );
    }
    else {
      // ✅ Nếu có doctorId, lấy shift của bác sĩ theo ngày
      res = await emitTyped<{ doctorId: string; date: string }, TimeSlot[]>(
        this.eventEmitter,
        "timeslot.get.by.doctor.and.date",
        { doctorId, date }
      );
    }
     return Array.isArray(res) ? res : [];
  }
}