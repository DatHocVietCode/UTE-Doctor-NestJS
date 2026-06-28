import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { HydratedDocument } from 'mongoose';
import { Account } from 'src/account/schemas/account.schema';
import { Profile } from 'src/profile/schema/profile.schema';

export type ReceptionistDocument = HydratedDocument<Receptionist>;

@Schema({ timestamps: true })
export class Receptionist {
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: Profile.name, required: true })
  profileId: mongoose.Types.ObjectId;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: Account.name, required: true })
  accountId: mongoose.Types.ObjectId;

  @Prop()
  hospitalName: string;
}

export const ReceptionistSchema = SchemaFactory.createForClass(Receptionist);
