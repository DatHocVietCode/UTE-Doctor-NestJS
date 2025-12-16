// profile.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { HydratedDocument } from 'mongoose';


export type ProfileDocument = HydratedDocument<Profile>;

@Schema({ timestamps: true })
export class Profile {
  _id: mongoose.Types.ObjectId;

  @Prop({ default: '' })
  name: string;

  @Prop({ default: '' })
  address: string;

  @Prop({ default: '' })
  phone: string;

  @Prop({ default: '' })
  email: string;

  @Prop({ default: '' })
  gender: string;

  @Prop({ default: null })
  dob: Date;

  @Prop({ default: '' })
  avatarUrl: string;
}

export const ProfileSchema = SchemaFactory.createForClass(Profile);
