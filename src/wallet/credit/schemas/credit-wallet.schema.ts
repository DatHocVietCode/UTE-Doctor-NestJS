import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { HydratedDocument } from 'mongoose';

export type CreditWalletDocument = HydratedDocument<CreditWallet>;

@Schema({ timestamps: true })
export class CreditWallet {
	_id: mongoose.Types.ObjectId;

	@Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true, unique: true })
	patientId: mongoose.Types.ObjectId;

	@Prop({ default: 0 })
	creditBalance: number;

	@Prop({ default: 0 })
	totalCredited: number;

	@Prop({ default: 0 })
	totalDebited: number;

	@Prop({ default: Date.now })
	createdAt: Date;

	@Prop({ default: Date.now })
	updatedAt: Date;
}

export const CreditWalletSchema = SchemaFactory.createForClass(CreditWallet);
