import { Injectable, Logger } from "@nestjs/common";
import { EventEmitter2, OnEvent } from "@nestjs/event-emitter";
import { RegisterShiftDto } from "src/shift/dto/register-shift.dto";

@Injectable()
export class RegisterShiftSaga {
  private readonly logger = new Logger(RegisterShiftSaga.name);

  constructor(private readonly eventEmitter: EventEmitter2) {}

  @OnEvent("shift.register.requested")
  async handleRegisterShift(payload: RegisterShiftDto) {
    this.logger.log(`⚙️ [Saga] Xử lý yêu cầu đăng ký ca: ${JSON.stringify(payload)}`);

    try {
      // 1️⃣ Kiểm tra bác sĩ tồn tại
      this.logger.log(`[Saga] 🔍 Gửi request kiểm tra bác sĩ: ${payload.doctorId}`);
      
      const doctorExistResults = await this.eventEmitter.emitAsync("doctor.check.exist", {
        doctorId: payload.doctorId,
      });

      this.logger.log(`[Saga] 📦 Raw doctor check results:`, doctorExistResults);

      // Chờ và resolve Promise nếu cần
      let isDoctorExist = doctorExistResults?.[0];
      if (isDoctorExist instanceof Promise) {
        isDoctorExist = await isDoctorExist;
      }
      isDoctorExist = isDoctorExist === true;

      this.logger.log(`[Saga] ✅ Kết quả kiểm tra bác sĩ: ${isDoctorExist}`);

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
      this.logger.log(`[Saga] 🔍 Gửi request kiểm tra trùng ca`);
      
      const duplicateResults = await this.eventEmitter.emitAsync("shift.check.duplicate", {
        doctorId: payload.doctorId,
        date: payload.date,
        shift: payload.shift,
      });

      this.logger.log(`[Saga] 📦 Raw duplicate check results:`, duplicateResults);

      // Chờ và resolve Promise nếu cần
      let isDuplicate = duplicateResults?.[0];
      if (isDuplicate instanceof Promise) {
        isDuplicate = await isDuplicate;
      }
      isDuplicate = isDuplicate === true;

      this.logger.log(`[Saga] ✅ Kết quả kiểm tra trùng: ${isDuplicate}`);

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
      this.logger.log(`[Saga] 🔍 Gửi request tạo ca`);
      
      const saveResults = await this.eventEmitter.emitAsync("shift.create.requested", {
        dto: payload,
      });

      let savedShift = saveResults?.[0];
      if (savedShift instanceof Promise) {
        savedShift = await savedShift;
      }

      if (!savedShift) {
        this.logger.error("❌ [Saga] Không thể lưu ca làm việc");
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