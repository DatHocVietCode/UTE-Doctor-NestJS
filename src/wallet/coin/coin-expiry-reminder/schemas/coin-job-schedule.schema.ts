import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { HydratedDocument } from 'mongoose';

export type CoinJobScheduleDocument = HydratedDocument<CoinJobSchedule>;

@Schema({ timestamps: true })
export class CoinJobSchedule {
	_id: mongoose.Types.ObjectId;

	@Prop({ required: true, unique: true, index: true })
	jobId!: string;

	@Prop({ required: true, index: true })
	transactionId!: string;

	@Prop({ required: true, index: true })
	patientId!: string;

	@Prop({ required: true, enum: ['COIN_EXPIRY_REMINDER'], index: true })
	type!: 'COIN_EXPIRY_REMINDER';

	@Prop({ required: true, index: true })
	runAt!: Date;

	@Prop({ required: true, default: 'PENDING', index: true })
	status!: 'PENDING' | 'DONE' | 'FAILED';

	@Prop({ required: true, default: 0 })
	retryCount!: number;

	@Prop()
	lastError?: string;

	@Prop({ default: Date.now })
	createdAt!: Date;

	@Prop({ default: Date.now })
	updatedAt!: Date;
}

export const CoinJobScheduleSchema = SchemaFactory.createForClass(CoinJobSchedule);

// Polling is driven by runAt, so the scheduler can quickly find due jobs without collection scans.
CoinJobScheduleSchema.index({ status: 1, runAt: 1 });
