import { Injectable, Logger } from "@nestjs/common";
import { EventEmitter2, OnEvent } from "@nestjs/event-emitter";
import { RegisterShiftDto } from "src/shift/dto/register-shift.dto";

@Injectable()
export class RegisterShiftSaga {
  private readonly logger = new Logger(RegisterShiftSaga.name);

  constructor(private readonly eventEmitter: EventEmitter2) {}

  // Helper: normalize emitAsync raw results to a single meaningful value (await Promises)
  private async resolveResult<T = any>(raw: any): Promise<T | undefined> {
    if (raw === undefined || raw === null) return undefined;

    // If emitAsync returned an array of listener results, prefer the first non-null/undefined item.
    if (Array.isArray(raw)) {
      for (const item of raw) {
        if (item !== undefined && item !== null) {
          raw = item;
          break;
        }
      }
      // if all items were undefined/null, keep raw as array (likely empty) -> return undefined below
      if (Array.isArray(raw) && raw.length === 0) return undefined;
    }

    // If the resolved value is a Promise, await it
    if (raw instanceof Promise) {
      try {
        raw = await raw;
      } catch (err) {
        this.logger.warn(`[Saga] Warning while awaiting listener promise: ${err?.message || err}`);
        return undefined;
      }
    }

    return raw as T;
  }

  @OnEvent("shift.register.requested")
  async handleRegisterShift(payload: RegisterShiftDto) {
    this.logger.log(`⚙️ [Saga] Xử lý yêu cầu đăng ký ca: ${JSON.stringify(payload)}`);

    let createdTimeSlotIds: string[] = [];

    try {
      this.logger.log(`[Saga] 🔍 Bước 1: Kiểm tra bác sĩ: ${payload.doctorId}`);
      
      const doctorExistResults = await this.eventEmitter.emitAsync("doctor.check.exist", {
        doctorId: payload.doctorId,
      });

      this.logger.log(`[Saga] 📦 Raw doctor check results:`, doctorExistResults);

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
          message: "Bác sĩ không tồn tại",
          data: null,
        };
      }

      this.logger.log(`[Saga] 🔍 Bước 2: Kiểm tra trùng ca`);
      
      const duplicateResults = await this.eventEmitter.emitAsync("shift.check.duplicate", {
        doctorId: payload.doctorId,
        date: payload.date,
        shift: payload.shift,
      });

      this.logger.log(`[Saga] 📦 Raw duplicate check results:`, duplicateResults);

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
          reason: "Duplicate shift",
        });
        return {
          code: "FAILED",
          message: "Ca này đã được đăng ký trước đó",
          data: null,
        };
      }

      this.logger.log(`[Saga] 🔍 Bước 3: Lấy TimeSlotData cho shift: ${payload.shift}`);
      
      const timeSlotDataResults = await this.eventEmitter.emitAsync("timeslot.data.get.by.shift", {
        shift: payload.shift,
      });

      this.logger.log(`[Saga] 📦 Raw TimeSlotData results: ${JSON.stringify(timeSlotDataResults)}`);

      // Normalize result: listener might return array of TimeSlotData, or emitAsync may wrap it.
      let timeSlotDataList = await this.resolveResult<any[]>(timeSlotDataResults);

      this.logger.log(`[Saga] 📊 TimeSlotData type: ${typeof timeSlotDataList}`);
      this.logger.log(`[Saga] 📊 TimeSlotData is array: ${Array.isArray(timeSlotDataList)}`);
      this.logger.log(`[Saga] 📊 TimeSlotData length: ${timeSlotDataList?.length}`);

      if (!timeSlotDataList || !Array.isArray(timeSlotDataList) || timeSlotDataList.length === 0) {
        this.logger.error(`❌ [Saga] Không tìm thấy TimeSlotData cho shift: ${payload.shift}`);
        await this.eventEmitter.emitAsync("shift.register.failed", {
          dto: payload,
          reason: "No TimeSlotData found",
        });
        return {
          code: "FAILED",
          message: `Không tìm thấy dữ liệu timeslot cho ca ${payload.shift}`,
          data: null,
        };
      }

      this.logger.log(`[Saga] ✅ Tìm thấy ${timeSlotDataList.length} TimeSlotData`);
      this.logger.log(`[Saga] 🔍 Bước 4: Tạo TimeSlotLog từ TimeSlotData`);
      
      const timeSlotLogResults = await this.eventEmitter.emitAsync("timeslot.log.create.from.data", {
        timeSlotDataList,
      });

      this.logger.log(`[Saga] 📦 Raw TimeSlotLog creation results: ${JSON.stringify(timeSlotLogResults)}`);

      let createdTimeSlotLogs = await this.resolveResult<any[]>(timeSlotLogResults);

      this.logger.log(`[Saga] 📊 Created TimeSlotLogs type: ${typeof createdTimeSlotLogs}`);
      this.logger.log(`[Saga] 📊 Created TimeSlotLogs is array: ${Array.isArray(createdTimeSlotLogs)}`);
      this.logger.log(`[Saga] 📊 Created TimeSlotLogs length: ${createdTimeSlotLogs?.length}`);

      if (!createdTimeSlotLogs || !Array.isArray(createdTimeSlotLogs) || createdTimeSlotLogs.length === 0) {
        this.logger.error("❌ [Saga] Không thể tạo TimeSlotLog từ TimeSlotData");
        await this.eventEmitter.emitAsync("shift.register.failed", {
          dto: payload,
          reason: "TimeSlotLog creation failed",
        });
        return {
          code: "FAILED",
          message: "Không thể tạo timeslot log",
          data: null,
        };
      }

      // Lưu lại IDs để rollback nếu cần
      createdTimeSlotIds = createdTimeSlotLogs.map((log: any) => log._id?.toString?.() ?? log.id ?? null).filter(Boolean);
      this.logger.log(`[Saga] ✅ Đã tạo ${createdTimeSlotIds.length} TimeSlotLog`);
      this.logger.log(`[Saga] 📝 TimeSlot IDs:`, createdTimeSlotIds);
      this.logger.log(`[Saga] 🔍 Bước 5: Tạo ca làm việc`);
      
      const saveResults = await this.eventEmitter.emitAsync("shift.create.requested", {
        dto: payload,
        timeSlotIds: createdTimeSlotIds,
      });

      this.logger.log(`[Saga] 📦 Raw shift creation results:`, saveResults);

      let savedShift = saveResults?.[0];
      if (savedShift instanceof Promise) {
        this.logger.log(`[Saga] ⏳ Awaiting shift creation Promise...`);
        savedShift = await savedShift;
      }

      this.logger.log(`[Saga] 📊 Saved shift:`, savedShift);

      if (!savedShift || !savedShift._id) {
        this.logger.error("❌ [Saga] Không thể lưu ca làm việc");
        
        // 🔄 Rollback: Xóa TimeSlotLog đã tạo
        this.logger.log(`🔄 [Saga] Bắt đầu rollback ${createdTimeSlotIds.length} TimeSlotLog`);
        await this.eventEmitter.emitAsync("shift.rollback.timeslots", {
          timeSlotIds: createdTimeSlotIds,
        });

        await this.eventEmitter.emitAsync("shift.register.failed", {
          dto: payload,
          reason: "Failed to save shift",
        });
        
        return {
          code: "FAILED",
          message: "Không thể lưu ca làm việc",
          data: null,
        };
      }

      this.logger.log(`✅ [Saga] Đăng ký ca thành công!`);
      this.logger.log(`✅ [Saga] Shift ID: ${savedShift._id}`);
      this.logger.log(`✅ [Saga] Đã tạo ${createdTimeSlotIds.length} TimeSlot`);
      
      await this.eventEmitter.emitAsync("shift.register.success", {
        dto: payload,
        shift: savedShift,
      });

      return {
        code: "SUCCESS",
        message: "Đăng ký ca thành công",
        data: {
          shift: savedShift,
          totalTimeSlots: createdTimeSlotIds.length,
          timeSlotIds: createdTimeSlotIds,
        },
      };

    } catch (error) {
      this.logger.error("❌ [Saga] Lỗi khi xử lý đăng ký ca:", error);
      this.logger.error("❌ [Saga] Error stack:", error.stack);

      // 🔄 Rollback nếu đã tạo TimeSlotLog
      if (createdTimeSlotIds.length > 0) {
        this.logger.log(`🔄 [Saga] Rollback ${createdTimeSlotIds.length} TimeSlotLog do lỗi`);
        try {
          await this.eventEmitter.emitAsync("shift.rollback.timeslots", {
            timeSlotIds: createdTimeSlotIds,
          });
          this.logger.log(`✅ [Saga] Rollback thành công`);
        } catch (rollbackError) {
          this.logger.error(`❌ [Saga] Lỗi khi rollback:`, rollbackError);
        }
      }

      await this.eventEmitter.emitAsync("shift.register.failed", {
        dto: payload,
        error: error.message,
      });

      return {
        code: "ERROR",
        message: error.message || "Lỗi không xác định",
        data: null,
      };
    }
  }


  @OnEvent("shift.register.success")
  async handleRegisterSuccess(payload: { dto: RegisterShiftDto; shift: any }) {
    this.logger.log(`🎉 [Saga] Shift đăng ký thành công:`, {
      shiftId: payload.shift._id,
      doctorId: payload.dto.doctorId,
      date: payload.dto.date,
      shift: payload.dto.shift,
    });
  }

  @OnEvent("shift.register.failed")
  async handleRegisterFailed(payload: { dto: RegisterShiftDto; reason?: string; error?: string }) {
    this.logger.warn(`⚠️ [Saga] Shift đăng ký thất bại:`, {
      doctorId: payload.dto.doctorId,
      date: payload.dto.date,
      shift: payload.dto.shift,
      reason: payload.reason,
      error: payload.error,
    });
  }
}