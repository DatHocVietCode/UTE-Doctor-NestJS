import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { HydratedDocument } from 'mongoose';
import { AccountStatusEnum } from 'src/common/enum/account-status.enum';
import { GenderEnum } from 'src/common/enum/gender.enum';

export type AccountDocument = HydratedDocument<Account>;
@Schema({ timestamps: true })
export class Account {
  _id: mongoose.Types.ObjectId;
  
  @Prop()
  fullName: string;

  @Prop({ required: true, unique: true })
  email: string;

  @Prop({ required: true })
  password: string;

  @Prop({ default: GenderEnum.OTHER, type: String, enum: GenderEnum})
  gender: GenderEnum;

  @Prop()
  dob: Date;

  @Prop()
  address: string;

  @Prop()
  avatarUrl?: string;

  @Prop()
  phoneNumber: string;
  
  // 👇 role dùng như "cache" phân quyền nhanh
  @Prop({ required: true, enum: ['PATIENT', 'DOCTOR', 'RECEPTIONIST', 'ADMIN'] })
  role: string;

  @Prop({ default: Date.now })
  createdAt: Date;

  @Prop({ default: Date.now })
  updatedAt: Date;

  @Prop()
  refreshToken: string;

  @Prop()
  accessToken: string;

  @Prop({ default: AccountStatusEnum.INACTIVE
        , type: String,
        enum: AccountStatusEnum
  } )
  status: AccountStatusEnum;

  @Prop({ default: null})
  otp: string;

  @Prop({default: null})
  otpCreatedAt: Date;

  @Prop({ default: null})
  otpExpiredAt: Date;

}

export const AccountSchema = SchemaFactory.createForClass(Account);

