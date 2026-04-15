import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { HydratedDocument } from 'mongoose';

export type CoinSpendAllocationDocument = HydratedDocument<CoinSpendAllocation>;

@Schema({ timestamps: true })
export class CoinSpendAllocation {
	_id!: mongoose.Types.ObjectId;

	@Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'CoinTransaction', required: true })
	spendTransactionId!: mongoose.Types.ObjectId;

	@Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'CoinTransaction', required: true })
	earnTransactionId!: mongoose.Types.ObjectId;

	@Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true })
	patientId!: mongoose.Types.ObjectId;

	@Prop({ required: true, min: 0 })
	amount!: number;

	@Prop({ default: Date.now })
	createdAt!: Date;

	@Prop({ default: Date.now })
	updatedAt!: Date;
}

export const CoinSpendAllocationSchema = SchemaFactory.createForClass(CoinSpendAllocation);

CoinSpendAllocationSchema.index({ patientId: 1, spendTransactionId: 1 });
CoinSpendAllocationSchema.index({ patientId: 1, earnTransactionId: 1 });
CoinSpendAllocationSchema.index({ spendTransactionId: 1, earnTransactionId: 1 }, { unique: true });
