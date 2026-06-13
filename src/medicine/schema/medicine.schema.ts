import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { HydratedDocument } from "mongoose";

export type MedicineDocument = HydratedDocument<Medicine>;

@Schema({ timestamps: true })
export class Medicine {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  packaging: string;

  /**
   * Current selling price per unit (VND).
   * Used for billing calculation when prescriptions are generated.
   * TODO: Future PrescriptionItem must snapshot medicineId, medicineName, quantity, unitPrice, and lineTotal
   * at the time of prescription creation to prevent pricing drift in completed bills.
   */
  @Prop({ required: true, min: 0, default: 0, type: Number })
  unitPrice: number;
}

export const MedicineSchema = SchemaFactory.createForClass(Medicine);
