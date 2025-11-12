import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import mongoose, { HydratedDocument } from "mongoose";
import { BloodType } from "src/common/enum/blood-type.enum";

export class PrescriptionItem {
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: "Medicine", required: true })
  medicineId: mongoose.Types.ObjectId; // tham chiếu đến thuốc trong bảng Medicine

  @Prop({ type: String, required: true })
  name: string; // tên thuốc (có thể lưu kèm để tránh mất thông tin nếu thuốc bị xóa)

  @Prop({ type: Number, required: true })
  quantity: number; // số lượng thuốc

}

export const PrescriptionItemSchema = SchemaFactory.createForClass(PrescriptionItem);

export type VitalSignRecordDocument = HydratedDocument<VitalSignRecord>;
@Schema()
export class VitalSignRecord {
  @Prop({ type: Number, required: false })
  value?: number; // dùng cho nhịp tim

  @Prop({ type: Object, required: false })
  bloodPressure?: { systolic: number; diastolic: number }; // dùng cho huyết áp

  @Prop({ type: Date, required: true })
  dateRecord: Date;
}
export const VitalSignRecordSchema = SchemaFactory.createForClass(VitalSignRecord);



export type MedicalRecordDescriptionDocument = HydratedDocument<MedicalRecordDescription>;
@Schema()
export class MedicalRecordDescription {
  @Prop({ required: true })
  diagnosis: string; // Chuẩn đoán chính

  @Prop({ type: [PrescriptionItemSchema], default: [] })
  prescriptions: PrescriptionItem[]; // Đơn thuốc

  @Prop({ type: String })
  note: string; // Ghi chú của bác sĩ

  @Prop({ type: Date, required: true })
  dateRecord: Date; // Ngày khám
}
export const MedicalRecordDescriptionSchema = SchemaFactory.createForClass(MedicalRecordDescription);

export type MedicalRecordDocument = HydratedDocument<MedicalRecord>;
@Schema()
export class MedicalRecord {
  @Prop()
  height: number; // cm

  @Prop()
  weight: number; // kg

  @Prop({ enum: BloodType })
  bloodType: BloodType;

  @Prop({ type: [MedicalRecordDescriptionSchema], default: [] })
  medicalHistory: MedicalRecordDescription[];

  @Prop({ type: [MedicalRecordDescriptionSchema], default: [] })
  drugAllergies: MedicalRecordDescription[];

  @Prop({ type: [MedicalRecordDescriptionSchema], default: [] })
  foodAllergies: MedicalRecordDescription[];

  @Prop({ type: [VitalSignRecordSchema], default: [] })
  bloodPressure: VitalSignRecord[];

  @Prop({ type: [VitalSignRecordSchema], default: [] })
  heartRate: VitalSignRecord[];
}
export const MedicalRecordSchema = SchemaFactory.createForClass(MedicalRecord);


