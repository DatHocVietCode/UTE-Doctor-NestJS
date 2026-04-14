import { BadRequestException, Injectable } from "@nestjs/common";
import { EventEmitter2, OnEvent } from "@nestjs/event-emitter";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { AppointmentStatus } from "src/appointment/enums/Appointment-status.enum";
import { AppointmentEnriched } from "src/appointment/schemas/appointment-enriched";
import { Appointment, AppointmentDocument } from "src/appointment/schemas/appointment.schema";
import { DataResponse } from "src/common/dto/data-respone";
import { ResponseCode as rc } from "src/common/enum/reponse-code.enum";
import { TimeSlotDto } from "src/timeslot/dtos/timeslot.dto";
import { TimeSlotStatusEnum } from "src/timeslot/enums/timeslot-status.enum";
import { TimeSlotData } from "src/timeslot/schemas/timeslot-data.schema";
import { TimeSlotLog } from "src/timeslot/schemas/timeslot-log.schema";
import { DateTimeHelper } from "src/utils/helpers/datetime.helper";
import { emitTyped } from "src/utils/helpers/event.helper";
import { TimeHelper } from "src/utils/helpers/time.helper";
import { RegisterShiftDto } from "./dto/register-shift.dto";
import { ShiftStatusEnum } from "./enums/shift-status.enum";
import { Shift } from "./schema/shift.schema";

@Injectable()
export class ShiftService {
  constructor(
    private readonly eventEmitter: EventEmitter2,
    @InjectModel(Shift.name) private readonly shiftModel: Model<Shift>,
    @InjectModel(TimeSlotLog.name) private readonly timeSlotLogModel: Model<TimeSlotLog>,
    @InjectModel(TimeSlotData.name) private readonly timeSlotDataModel: Model<TimeSlotData>,
    @InjectModel(Appointment.name) private readonly appointmentModel: Model<AppointmentDocument>,
  ) {}

  async registerShift(dto: RegisterShiftDto): Promise<DataResponse> {
    console.log("📩 [ShiftService] Nhận yêu cầu đăng ký ca:", dto);

    try {
      const { startUtc, endUtc, startEpoch, endEpoch, dateKey } = this.buildRegisterShiftTimeContext(dto);

      TimeHelper.debugLog('[RegisterShiftTime]', {
        inputStartTime: dto.startTime,
        inputEndTime: dto.endTime,
        utcStartTime: startUtc.toISOString(),
        utcEndTime: endUtc.toISOString(),
        epochStart: startEpoch,
        epochEnd: endEpoch,
      });

      const normalizedDto: RegisterShiftDto = {
        ...dto,
        startTimeUtc: startUtc.toISOString(),
        endTimeUtc: endUtc.toISOString(),
        startTimeEpoch: startEpoch,
        endTimeEpoch: endEpoch,
        dateKey,
      };

      const results = await this.eventEmitter.emitAsync("shift.register.requested", normalizedDto);
      
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
      if (error instanceof BadRequestException) {
        throw error;
      }
      return {
        code: rc.ERROR,
        message: this.toErrorMessage(error) || "Unexpected error",
        data: null,
      };
    }
  }

  @OnEvent("shift.check.duplicate")
  async handleCheckDuplicate(payload: {
    doctorId: string;
    startTimeEpoch: number;
    endTimeEpoch: number;
    dateKey?: string;
    shift: string;
  }): Promise<boolean> {
    console.log(
      `[ShiftService] 🔍 Bắt đầu kiểm tra trùng ca:`,
      payload
    );

    try {
      const normalizedDate = payload.dateKey || this.getShiftDateKeyFromEpoch(payload.startTimeEpoch);

      const exists = await this.shiftModel
        .exists({
          doctorId: payload.doctorId,
          shift: payload.shift,
          $or: [
            {
              startTimeEpoch: payload.startTimeEpoch,
              endTimeEpoch: payload.endTimeEpoch,
            },
            { date: normalizedDate },
            { date: { $regex: `^${normalizedDate}` } },
          ],
        })
        .exec();

      const isDuplicate = !!exists;
      
      console.log(
        `[ShiftService] ✅ Kết quả kiểm tra trùng ca → ${isDuplicate}`
      );

      return isDuplicate;
    } catch (error) {
      console.error("[ShiftService] ❌ Lỗi khi kiểm tra trùng ca:", this.toErrorMessage(error));
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
  async handleCreateShift(event: { dto: RegisterShiftDto; timeSlotIds?: string[] }): Promise<any> {
    const { dto, timeSlotIds: providedTimeSlotIds } = event;
    console.log("🟢 [ShiftService] Nhận yêu cầu tạo ca:", dto);

    try {
      // 1️⃣ Lấy TimeSlotData tương ứng với shift type
      const timeSlotDataList = await this.getTimeSlotDataByShift(dto.shift);

      if (timeSlotDataList.length === 0) {
        throw new Error(`Không tìm thấy TimeSlotData cho shift: ${dto.shift}`);
      }

      // 2️⃣ Nếu saga đã tạo TimeSlotLog trước đó và truyền vào IDs, dùng lại
      let timeSlotLogs: any[] = [];
      if (Array.isArray(providedTimeSlotIds) && providedTimeSlotIds.length > 0) {
        console.log("[ShiftService] Sử dụng TimeSlotLog đã có từ saga, IDs:", providedTimeSlotIds);
        // Lấy chi tiết từ DB để đảm bảo có đầy đủ trường
        timeSlotLogs = await this.timeSlotLogModel.find({ _id: { $in: providedTimeSlotIds } }).lean().exec();
        // Nếu DB không trả đủ, fallback tạo các TimeSlotLog mới từ data
        if (!Array.isArray(timeSlotLogs) || timeSlotLogs.length !== providedTimeSlotIds.length) {
          console.warn("[ShiftService] Không tìm thấy toàn bộ TimeSlotLog được cung cấp, sẽ tạo mới từ data");
          timeSlotLogs = await this.createTimeSlotLogsFromData(timeSlotDataList);
        }
      } else {
        // 2️⃣ Tạo các TimeSlotLog từ TimeSlotData (thao tác cũ)
        timeSlotLogs = await this.createTimeSlotLogsFromData(timeSlotDataList);
      }

      // 3️⃣ Lấy danh sách ID của TimeSlotLog
      const timeSlotIds = timeSlotLogs.map(log => log._id);

      if (!Number.isFinite(dto.startTimeEpoch) || !Number.isFinite(dto.endTimeEpoch)) {
        throw new Error('Missing normalized shift epoch values');
      }

      // 4️⃣ Tạo Shift với các TimeSlot đã tạo
      const shiftData: any = {
        doctorId: dto.doctorId,
        startTimeEpoch: dto.startTimeEpoch,
        endTimeEpoch: dto.endTimeEpoch,
        date: dto.dateKey ?? this.getShiftDateKeyFromEpoch(dto.startTimeEpoch!),
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
      console.error("❌ [ShiftService] Lỗi khi tạo shift:", this.toErrorMessage(error));
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

      // Tính range UTC epoch theo tháng
      const monthStartEpoch = Date.UTC(yearNum, monthNum - 1, 1, 0, 0, 0, 0);
      const nextMonthStartEpoch = Date.UTC(yearNum, monthNum, 1, 0, 0, 0, 0);

      console.log("🔍 [ShiftService] Date range:", { monthStartEpoch, nextMonthStartEpoch });

      // Build query filter
      const filter: any = {
        doctorId,
        startTimeEpoch: { $gte: monthStartEpoch, $lt: nextMonthStartEpoch },
      };

      if (status) {
        filter.status = status;
      }

      console.log("🔍 [ShiftService] Query filter:", filter);

 
      // Lấy danh sách ca và populate TimeSlotLog
      const shifts = await this.shiftModel
        .find(filter)
        .sort({ startTimeEpoch: 1, shift: 1 })
        .populate('timeSlots') // Populate thông tin TimeSlot
        .lean()
        .exec();

      console.log(`✅ [ShiftService] Tìm thấy ${shifts.length} ca trong tháng ${month}/${year}`);

      // Nhóm theo ngày để dễ hiển thị
      const groupedByDate = shifts.reduce((acc, shift) => {
        const date = Number.isFinite(shift.startTimeEpoch)
          ? this.getShiftDateKeyFromEpoch(shift.startTimeEpoch)
          : shift.date;
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
      console.error("❌ [ShiftService] Lỗi khi lấy ca theo tháng:", this.toErrorMessage(error));
      return {
        code: rc.ERROR,
        message: this.toErrorMessage(error) || "Lỗi khi lấy danh sách ca",
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

  async cancelShiftById(id: string, reason: string, user?: any): Promise<DataResponse> {
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

      // Authorization: only owning doctor can cancel
      if (user?.doctorId && shift.doctorId?.toString?.() && shift.doctorId.toString() !== user.doctorId) {
        return {
          code: rc.ERROR,
          message: "Không có quyền hủy ca này.",
          data: shift.toObject(),
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

      // Xóa tất cả TimeSlotLog liên quan khi hủy ca
      if (shift.timeSlots && shift.timeSlots.length > 0) {
        await this.timeSlotLogModel.deleteMany({
          _id: { $in: shift.timeSlots }
        }).exec();
        console.log(`[ShiftService] Đã xóa ${shift.timeSlots.length} TimeSlotLog khi hủy ca`);
      }

      // Tìm tất cả lịch hẹn bị ảnh hưởng để gửi thông báo + email cho bệnh nhân và hoàn credit
      try {
        const affectedAppointments = await this.appointmentModel
          .find({
            timeSlot: { $in: shift.timeSlots },
            appointmentStatus: { $in: [AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED] },
          })
          .populate({ path: 'doctorId' })
          .lean()
          .exec();

        console.log(`[ShiftService] Có ${affectedAppointments.length} lịch hẹn bị ảnh hưởng bởi hủy ca.`);

        for (const appt of affectedAppointments) {
          const shiftDateText = Number.isFinite(shift.startTimeEpoch)
            ? this.getShiftDateKeyFromEpoch(shift.startTimeEpoch)
            : (DateTimeHelper.toUtcDateOnlyString(shift.date) ?? String(shift.date));
          const payload = {
            appointmentId: appt._id?.toString?.() ?? String(appt._id),
            patientEmail: appt.patientEmail,
            doctorEmail: user?.email,
            doctorName: (appt as any).doctorId?.doctorName ?? undefined,
            date: shiftDateText,
            timeSlot: appt.timeSlot?.toString?.() ?? String(appt.timeSlot),
            hospitalName: appt.hospitalName,
            reason,
          };

          // Emit sự kiện để module notification và mail xử lý cho bệnh nhân
          this.eventEmitter.emit('notify.patient.shift.cancelled', payload);
          this.eventEmitter.emit('mail.patient.shift.cancelled', payload);
          // Push socket to patient (and optionally doctor room)
          this.eventEmitter.emit('socket.shift.cancelled', payload);

          // Hoàn credit cho bệnh nhân theo số tiền đã thu sau discount.
          const refundAmount = (appt as any).paymentAmount ?? appt.consultationFee ?? 100000;
          this.eventEmitter.emit('wallet.refund.shift.cancelled', {
            appointmentId: appt._id?.toString?.() ?? String(appt._id),
            patientId: appt.patientId?.toString?.() ?? String(appt.patientId),
            refundAmount,
            reason: `Hoàn tiền do bác sĩ hủy ca${reason ? `: ${reason}` : ''}`,
          });
        }

        // Gửi thông báo + email cho bác sĩ về việc hủy ca
        if (user?.email) {
          const shiftDateText = Number.isFinite(shift.startTimeEpoch)
            ? this.getShiftDateKeyFromEpoch(shift.startTimeEpoch)
            : (DateTimeHelper.toUtcDateOnlyString(shift.date) ?? String(shift.date));
          const doctorPayload = {
            doctorEmail: user.email,
            doctorName: (affectedAppointments[0] as any)?.doctorId?.doctorName,
            date: shiftDateText,
            shift: shift.shift,
            reason,
            affectedAppointmentsCount: affectedAppointments.length,
          };
          this.eventEmitter.emit('notify.doctor.shift.cancelled', doctorPayload);
          this.eventEmitter.emit('mail.doctor.shift.cancelled', doctorPayload);
        }
      } catch (sideEffectErr: any) {
        console.error('[ShiftService] Lỗi khi xử lý thông báo/email hủy ca:', sideEffectErr?.message ?? sideEffectErr);
        // Không throw để tránh làm hủy ca thất bại; chỉ log lỗi
      }

      console.log("[ShiftService] Đã hủy ca thành công:", shift._id.toString());

      return {
        code: rc.SUCCESS,
        message: "Hủy ca thành công.",
        data: shift.toObject(),
      };
    } catch (error) {
      console.error("[ShiftService] Lỗi khi hủy ca:", this.toErrorMessage(error));
      return {
        code: rc.ERROR,
        message: this.toErrorMessage(error) || "Lỗi khi hủy ca.",
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
      const { startEpoch, endEpoch, dateKey } = this.getUtcDayEpochRangeFromDateOnly(date);
      const query: any = {
        doctorId,
        $or: [
          { startTimeEpoch: { $gte: startEpoch, $lt: endEpoch } },
          { date: dateKey },
          { date: { $regex: `^${dateKey}` } },
        ],
      };

      console.log("[ShiftService] Lấy TimeSlots cho bác sĩ:", doctorId, "ngày:", dateKey, "với filter:", query, "và status:", status);

      const shifts = await this.shiftModel
        .find(query)
        .populate({
          path: 'timeSlots',
          match: status ? { status } : {}, // filter chỉ những timeSlot có status
        })
        .exec();

      console.log(`[ShiftService] Tìm thấy ${shifts.length} ca cho bác sĩ ${doctorId} vào ngày ${dateKey} với shift ${shifts.map(s => s.shift).join(", ")}`);

      const slots = shifts.flatMap(s => s.timeSlots).map((slot: any) => ({
        id: slot._id.toString(),
        start: slot.start,
        end: slot.end,
        label: slot.label,
    }));

    return slots;

    }

  /**
   * Lấy shift theo bác sĩ và ngày, kèm thông tin TimeSlotLog và nếu có lịch hẹn cho từng timeSlot thì attach thông tin bệnh nhân
   */
  async getShiftByDoctorAndDate(doctorId: string, date: string) : Promise<any> {
    try {
      console.log("[ShiftService] Lấy shift cho bác sĩ:", doctorId, "ngày:", date);
      const { startEpoch, endEpoch, dateKey } = this.getUtcDayEpochRangeFromDateOnly(date);
      console.log('[ShiftService] getShiftByDoctorAndDate', { doctorId, date: dateKey, startEpoch, endEpoch });
      const shift = await this.shiftModel
        .findOne({
          doctorId,
          $or: [
            { startTimeEpoch: { $gte: startEpoch, $lt: endEpoch } },
            { date: dateKey },
            { date: { $regex: `^${dateKey}` } },
          ],
        })
        .populate('timeSlots')
        .lean()
        .exec();
      if (!shift) {
        return {
          code: 'SUCCESS',
          message: 'Không tìm thấy ca',
          data: null,
        };
      }

      // Tìm tất cả appointment liên quan tới các timeSlot của shift
      const timeSlotIds = (shift.timeSlots || []).map((t: any) => t._id?.toString ? t._id.toString() : t._id);

        const appointments = await this.appointmentModel.find({ timeSlot: { $in: timeSlotIds } })
          .populate({ path: 'patientId', select: 'profileId' })
          .populate({ path: 'patientId', populate: { path: 'profileId', select: 'name phone address email gender dob' } })
        .lean()
        .exec();

      // Map appointments theo timeSlot id
      const apptMap: Record<string, any> = {};
      for (const a of appointments) {
        const tsId = a.timeSlot?.toString?.();
        if (tsId) apptMap[tsId] = a;
      }

      // Attach patient info to each timeSlot entry
      const timeSlotDetails = (shift.timeSlots || []).map((t: any) => {
        const appt = apptMap[t._id?.toString?.()] ?? null;
        const patient = appt?.patientId ? {
          id: appt.patientId._id?.toString?.() ?? appt.patientId,
          name: appt.patientId?.profileId?.name ?? null,
          phone: appt.patientId?.profileId?.phone ?? null,
        } : null;
        return {
          ...t,
          patient,
        };
      });

      const result = {
        ...shift,
        timeSlotDetails,
      };

      return {
        code: 'SUCCESS',
        message: 'Lấy ca theo ngày thành công',
        data: result,
      };
    } catch (error) {
      console.error('[ShiftService] Lỗi getShiftByDoctorAndDate:', this.toErrorMessage(error));
      return {
        code: 'ERROR',
        message: this.toErrorMessage(error) ?? 'Lỗi',
        data: null,
      };
    }
  }
  
  async handleDoctorUpdateSchedule(payload: AppointmentEnriched): Promise<boolean> {
    try {
      const doctorId = payload.doctorId;
      const timeSlotId = payload.timeSlot._id.toString();
      console.log(
        '[ShiftService] Xử lý doctor.update-schedule:',
        { doctorId, timeSlotId, bookingDate: payload.date },
      );

      // Ưu tiên định danh theo doctorId + timeSlotId để tránh phụ thuộc vào ngữ nghĩa payload.date.
      let targetShift = await this.shiftModel
        .findOne({
          doctorId,
          timeSlots: payload.timeSlot._id,
        })
        .populate('timeSlots')
        .exec();

      // Fallback cho dữ liệu legacy: thử lookup theo date nếu chưa tìm thấy bằng timeSlot.
      if (!targetShift) {
        const parsedDate = DateTimeHelper.toUtcDate(payload.date);
        if (parsedDate) {
          const dateOnly = TimeHelper.toUtcDateOnly(parsedDate);
          const startEpoch = Date.UTC(
            parsedDate.getUTCFullYear(),
            parsedDate.getUTCMonth(),
            parsedDate.getUTCDate(),
            0,
            0,
            0,
            0,
          );
          const endEpoch = startEpoch + 24 * 60 * 60 * 1000;

          targetShift = await this.shiftModel
            .findOne({
              doctorId,
              timeSlots: payload.timeSlot._id,
              $or: [
                { startTimeEpoch: { $gte: startEpoch, $lt: endEpoch } },
                { date: dateOnly },
                { date: { $regex: `^${dateOnly}` } },
              ],
            })
            .populate('timeSlots')
            .exec();
        }
      }

      if (!targetShift) {
        console.warn(
          `[ShiftService] Không tìm thấy shift cho doctor=${doctorId}, timeSlot=${timeSlotId}`,
        );
        return false;
      }

      console.log(`[ShiftService] Đã tìm thấy shift ${targetShift._id} chứa TimeSlot ${timeSlotId}`);

      // 1️⃣ Update status của timeslot
      const updatedSlot = await this.timeSlotLogModel.updateOne(
        { _id: payload.timeSlot._id },
        { $set: { status: TimeSlotStatusEnum.BOOKED } }
      );

      if (updatedSlot.modifiedCount === 0) {
        console.warn(`[ShiftService] Cập nhật TimeSlot ${timeSlotId} thất bại.`);
        return false;
      }

      console.log(`[ShiftService] TimeSlot ${timeSlotId} cập nhật sang BOOKED thành công.`);

      // 2️⃣ Cập nhật shift sang HAS_CLIENT (nếu chưa có)
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

  private getUtcDayEpochRangeFromDateOnly(input: string): { startEpoch: number; endEpoch: number; dateKey: string } {
    const parsed = input?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!parsed) {
      throw new BadRequestException('date must be in YYYY-MM-DD format');
    }

    const [, y, m, d] = parsed;
    const startEpoch = Date.UTC(Number(y), Number(m) - 1, Number(d), 0, 0, 0, 0);
    const endEpoch = startEpoch + 24 * 60 * 60 * 1000;
    return {
      startEpoch,
      endEpoch,
      dateKey: `${y}-${m}-${d}`,
    };
  }

  private buildRegisterShiftTimeContext(dto: RegisterShiftDto): {
    startUtc: Date;
    endUtc: Date;
    startEpoch: number;
    endEpoch: number;
    dateKey: string;
  } {
    let startUtc: Date;
    let endUtc: Date;
    const allowLegacyFallback = dto.legacyAllowMissingTimezone === true;

    try {
      startUtc = TimeHelper.parseISOToUTC(dto.startTime, {
        allowLegacyNoTimezone: allowLegacyFallback,
        logPrefix: '[TimeWarning] RegisterShift.startTime',
      });
      endUtc = TimeHelper.parseISOToUTC(dto.endTime, {
        allowLegacyNoTimezone: allowLegacyFallback,
        logPrefix: '[TimeWarning] RegisterShift.endTime',
      });
    } catch (error) {
      throw new BadRequestException(this.toErrorMessage(error));
    }

    const startEpoch = TimeHelper.toEpoch(startUtc);
    const endEpoch = TimeHelper.toEpoch(endUtc);

    if (endEpoch <= startEpoch) {
      throw new BadRequestException('endTime must be greater than startTime');
    }

    return {
      startUtc,
      endUtc,
      startEpoch,
      endEpoch,
      dateKey: TimeHelper.toUtcDateOnly(startUtc),
    };
  }

  private getShiftDateKeyFromEpoch(epoch: number): string {
    return TimeHelper.toUtcDateOnly(TimeHelper.fromEpoch(epoch));
  }

  private toErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

}
