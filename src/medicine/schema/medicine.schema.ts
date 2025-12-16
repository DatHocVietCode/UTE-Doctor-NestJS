import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { HydratedDocument } from "mongoose";

export type MedicineDocument = HydratedDocument<Medicine>;

@Schema({ timestamps: true })
export class Medicine {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  packaging: string;
}

export const MedicineSchema = SchemaFactory.createForClass(Medicine);
