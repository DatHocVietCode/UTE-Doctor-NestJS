import { Injectable } from "@nestjs/common";
import { EventEmitter2, OnEvent } from "@nestjs/event-emitter";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { RegisterShiftDto } from "./dto/register-shift.dto";
import { Shift, ShiftDocument } from "./schema/shift.schema";
import { DataResponse } from "src/common/dto/data-respone";
import { ResponseCode as rc } from "src/common/enum/reponse-code.enum";

@Injectable()
export class ShiftService {
  constructor(
    private readonly eventEmitter: EventEmitter2,
    @InjectModel(Shift.name) private readonly shiftModel: Model<Shift>
  ) {}

  async registerShift(dto: RegisterShiftDto): Promise<DataResponse> {
    console.log("📩 [ShiftService] Nhận yêu cầu đăng ký ca:", dto);

    const results = await this.eventEmitter.emitAsync("shift.register.requested", dto);

    const response = results.find((res) => !!res) as DataResponse | undefined;

    if (!response) {
      return {
        code: rc.ERROR,
        message: "Không có phản hồi từ Saga hoặc listener.",
        data: null,
      };
    }

    return response;
  }

  @OnEvent("shift.check.duplicate", { async: true })
  async handleCheckDuplicate(payload: {
    doctorId: string;
    date: string;
    shift: string;
  }): Promise<boolean> {
    try {
      const exists = await this.shiftModel
        .exists({
          doctorId: payload.doctorId,
          date: payload.date,
          shift: payload.shift,
        })
        .exec();

      // exists là object hoặc null, cần trả về boolean
      const isDuplicate = !!exists;
      console.log(
        `[ShiftService]: Kiểm tra trùng ca (${payload.doctorId}, ${payload.date}, ${payload.shift}) → ${isDuplicate}`
      );

      return isDuplicate; // Đảm bảo trả về boolean
    } catch (error) {
      console.error("[ShiftService]: Lỗi khi kiểm tra trùng ca →", error.message);
      return false;
    }
  }

  @OnEvent("shift.create.requested", { async: true })
  async handleCreateShift(event: { dto: RegisterShiftDto }): Promise<ShiftDocument> {
    const { dto } = event;
    console.log("🟢 [ShiftService] Nhận yêu cầu tạo ca:", dto);

    const newShift = new this.shiftModel({
      doctorId: dto.doctorId,
      patientId: null,
      date: dto.date,
      shift: dto.shift,
      status: "available",
    });

    const savedShift = await newShift.save();
    console.log("✅ [ShiftService] Lưu ca thành công:", savedShift._id.toString());
    return savedShift;
  }
}
