import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { HydratedDocument } from 'mongoose';
import { AccountStatusEnum } from 'src/common/enum/account-status.enum';
import { GenderEnum } from 'src/common/enum/gender.enum';
import { BloodType } from 'src/common/enum/blood-type.enum';

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


export type MedicalRecordDocument = HydratedDocument<MedicalRecord>;
@Schema()
export class MedicalRecord {
  @Prop()
  height: number; // cm

  @Prop()
  weight: number; // kg

  @Prop({ enum: BloodType })
  bloodType: BloodType;

  @Prop()
  medicalHistory: MedicalRecordDescription[];

  @Prop()
  drugAllergies: MedicalRecordDescription[];

  @Prop()
  foodAllergies: MedicalRecordDescription[];

  @Prop({ type: [VitalSignRecordSchema], default: [] })
  bloodPressure: VitalSignRecord[];

  @Prop({ type: [VitalSignRecordSchema], default: [] })
  heartRate: VitalSignRecord[];
}
export const MedicalRecordSchema = SchemaFactory.createForClass(MedicalRecord);

export type MedicalRecordDescriptionDocument = HydratedDocument<MedicalRecordDescription>;
@Schema()
export class MedicalRecordDescription {
  @Prop()
  name: string;

  @Prop()
  descrition: string;

  @Prop()
  dateRecord: Date;
}
export const MedicalRecordDescriptionSchema = SchemaFactory.createForClass(MedicalRecordDescription)

export type UserDocument = HydratedDocument<User>;
@Schema({ timestamps: true})
export class User {

  _id: mongoose.Types.ObjectId;
  
  @Prop()
  fullName: string;

  @Prop({ required: true, unique: true })
  email: string;

  @Prop({ required: true })
  password: string;

  @Prop({ default: 'user' })
  role: string;

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

  @Prop()
  medicalRecord: MedicalRecord;
}
export const UserSchema = SchemaFactory.createForClass(User);

