import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ChuyenKhoaDocument = HydratedDocument<ChuyenKhoa>;

@Schema({ timestamps: true })
export class ChuyenKhoa {
  @Prop({ required: true })
  name: string;

  @Prop()
  description: string;

  @Prop({ default: true })
  status: boolean;   // true = hoạt động, false = ngừng
}

export const ChuyenKhoaSchema = SchemaFactory.createForClass(ChuyenKhoa);
