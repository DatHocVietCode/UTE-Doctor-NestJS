export type CoinExpiryReminderJobType = 'COIN_EXPIRY_REMINDER';

export type CoinExpiryReminderJobSchedule = {
	jobId: string;
	transactionId: string;
	patientId: string;
	type: CoinExpiryReminderJobType;
	runAt: Date;
	status: 'PENDING' | 'DONE' | 'FAILED';
	retryCount: number;
	lastError?: string;
	createdAt: Date;
	updatedAt: Date;
};

export type CoinExpiryReminderDispatchMessage = {
	jobId: string;
	transactionId: string;
	patientId: string;
	type: CoinExpiryReminderJobType;
	retryCount?: number;
};

export type CoinExpiryReminderEventPayload = {
	jobId: string;
	transactionId: string;
	patientId: string;
	patientEmail: string;
	patientName: string | null;
	amount: number;
	expiresAt: number;
	runAt: number;
	reminderDays: number;
	retryCount: number;
};
