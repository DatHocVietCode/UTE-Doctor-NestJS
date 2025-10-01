import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { HydratedDocument } from 'mongoose';
import { AccountStatusEnum } from 'src/common/enum/account-status.enum';

export type AccountDocument = HydratedDocument<Account>;
@Schema({ timestamps: true })
export class Account {
  _id: mongoose.Types.ObjectId;

  @Prop({ required: true })
  fullName: string;

  @Prop({ required: true, unique: true })
  email: string;

  @Prop({ required: true })
  password: string;

  // 👇 role dùng như "cache" phân quyền nhanh
  @Prop({ required: true, enum: ['PATIENT', 'DOCTOR', 'RECEPTIONIST', 'ADMIN'] })
  role: string;

  @Prop({ default: AccountStatusEnum.INACTIVE, enum: AccountStatusEnum })
  status: AccountStatusEnum;

  @Prop()
  refreshToken: string;

  @Prop()
  accessToken: string;

  @Prop({ default: null })
  otp: string;

  @Prop({ default: null })
  otpCreatedAt: Date;

  @Prop({ default: null })
  otpExpiredAt: Date;
}

export const AccountSchema = SchemaFactory.createForClass(Account);

