import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { HydratedDocument } from 'mongoose';

export type CoinWalletDocument = HydratedDocument<CoinWallet>;

@Schema({ timestamps: true })
export class CoinWallet {
	_id: mongoose.Types.ObjectId;

	@Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true, unique: true })
	patientId: mongoose.Types.ObjectId;

	@Prop({ default: 0 })
	coinBalance: number;

	@Prop({ default: 0 })
	totalCoinEarned: number;

	@Prop({ default: 0 })
	totalCoinUsed: number;

	@Prop({ default: Date.now })
	createdAt: Date;

	@Prop({ default: Date.now })
	updatedAt: Date;
}

export const CoinWalletSchema = SchemaFactory.createForClass(CoinWallet);
