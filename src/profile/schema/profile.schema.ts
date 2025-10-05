// profile.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ProfileDocument = HydratedDocument<Profile>;

@Schema({ timestamps: true })
export class Profile {

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
}

export const ProfileSchema = SchemaFactory.createForClass(Profile);
