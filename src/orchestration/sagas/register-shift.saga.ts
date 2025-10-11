import { Injectable, Logger } from "@nestjs/common";
import { EventEmitter2, OnEvent } from "@nestjs/event-emitter";
import { RegisterShiftDto } from "src/shift/dto/register-shift.dto";
import { emitTyped } from "src/utils/helpers/event.helper";

@Injectable()
export class RegisterShiftSaga {
  private readonly logger = new Logger(RegisterShiftSaga.name);

  constructor(private readonly eventEmitter: EventEmitter2) {}

  @OnEvent("shift.register.requested", { async: true })
  async handleRegisterShift(payload: RegisterShiftDto) {
    this.logger.log(`⚙️ [Saga] Xử lý yêu cầu đăng ký ca: ${JSON.stringify(payload)}`);

    try {
      // 1️⃣ Kiểm tra bác sĩ tồn tại
      const isDoctorExist = await emitTyped<{ doctorId: string }, boolean>(
        this.eventEmitter,
        "doctor.check.exist",
        { doctorId: payload.doctorId },
      );

      if (!isDoctorExist) {
        this.logger.warn(`⛔ Bác sĩ không tồn tại: ${payload.doctorId}`);
        await this.eventEmitter.emitAsync("shift.register.failed", {
          dto: payload,
          reason: "Doctor not found",
        });
        return {
          code: "FAILED",
          message: "Doctor not found",
          data: null,
        };
      }

      // 2️⃣ Kiểm tra ca trùng
      const duplicateResults = await emitTyped<
        { doctorId: string; date: string; shift: string },
        boolean
      >(this.eventEmitter, "shift.check.duplicate", {
        doctorId: payload.doctorId,
        date: payload.date,
        shift: payload.shift,
      });

      // Lấy giá trị boolean đúng
      const isDuplicate = Array.isArray(duplicateResults)
        ? duplicateResults[0]
        : duplicateResults;

      this.logger.log(`[Saga] Kết quả kiểm tra trùng: ${isDuplicate}`);


      if (isDuplicate) {
        this.logger.warn(`⚠️ Ca bị trùng: ${JSON.stringify(payload)}`);
        await this.eventEmitter.emitAsync("shift.register.failed", {
          dto: payload,
          reason: "Duplicate shift for this date",
        });
        return {
          code: "FAILED",
          message: "Duplicate shift for this date",
          data: null,
        };
      }

      // 3️⃣ Gửi event yêu cầu tạo ca
      const saveResults = await this.eventEmitter.emitAsync("shift.create.requested", {
        dto: payload,
      });

      // emitAsync trả về mảng các giá trị listener return — lấy phần tử đầu tiên
      const savedShift = saveResults?.[0];

      if (!savedShift) {
        this.logger.error("❌ [Saga] Không có listener nào xử lý shift.create.requested hoặc không trả dữ liệu");
        await this.eventEmitter.emitAsync("shift.register.failed", {
          dto: payload,
          reason: "Không thể lưu ca làm việc",
        });
        return {
          code: "FAILED",
          message: "Không thể lưu ca làm việc",
          data: null,
        };
      }

      // 4️⃣ Đăng ký thành công → emit success
      this.logger.log(`✅ [Saga] Đăng ký ca thành công: ${savedShift._id || "[Không có ID]"}`);
      await this.eventEmitter.emitAsync("shift.register.success", {
        dto: payload,
        shift: savedShift,
      });

      return {
        code: "SUCCESS",
        message: "Shift registered successfully",
        data: savedShift,
      };
    } catch (error) {
      this.logger.error("❌ [Saga] Lỗi khi xử lý đăng ký ca:", error);
      await this.eventEmitter.emitAsync("shift.register.failed", {
        dto: payload,
        error: error.message,
      });

      return {
        code: "ERROR",
        message: error.message || "Unexpected error",
        data: null,
      };
    }
  }
}
