import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import mongoose, { HydratedDocument } from "mongoose";
import { Account } from "src/account/schemas/account.schema";
import { ChuyenKhoa } from "src/chuyen-khoa/schemas/chuyenkhoa.schema";

export type DoctorDocument = HydratedDocument<Doctor>;

@Schema({ timestamps: true })
export class Doctor {
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: Account.name, required: true })
  accountId: mongoose.Types.ObjectId;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: ChuyenKhoa.name, required: true })
  chuyenKhoaId: mongoose.Types.ObjectId;   // liên kết tới chuyên khoa

  @Prop()
  degree: string;

  @Prop()
  yearsOfExperience: number;
}

export const DoctorSchema = SchemaFactory.createForClass(Doctor);
