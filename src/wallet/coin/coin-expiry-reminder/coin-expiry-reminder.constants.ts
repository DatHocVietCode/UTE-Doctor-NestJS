export const COIN_EXPIRY_REMINDER_TYPE = 'COIN_EXPIRY_REMINDER';

export const COIN_EXPIRY_REMINDER_MAIL_EVENT = 'mail.coin.expiry.reminder';
export const COIN_EXPIRY_REMINDER_NOTIFICATION_EVENT = 'notification.coin.expiry.reminder';

export const COIN_EXPIRY_REMINDER_REDIS_CHANNEL =
	process.env.COIN_EXPIRY_REMINDER_REDIS_CHANNEL?.trim() || 'coin.expiry.reminder';

export const COIN_EXPIRY_REMINDER_QUEUE =
	process.env.COIN_EXPIRY_REMINDER_QUEUE?.trim() ||
	process.env.RABBITMQ_QUEUE_NAME?.trim() ||
	'coin.expiry.reminder.jobs';
export const COIN_EXPIRY_REMINDER_EXCHANGE =
	process.env.COIN_EXPIRY_REMINDER_EXCHANGE?.trim() ||
	process.env.RABBITMQ_EXCHANGE?.trim() ||
	'coin.expiry.reminder.jobs';
export const COIN_EXPIRY_REMINDER_DLX_EXCHANGE = `${COIN_EXPIRY_REMINDER_EXCHANGE}.dlx`;
export const COIN_EXPIRY_REMINDER_DLQ_QUEUE = `${COIN_EXPIRY_REMINDER_QUEUE}.dlq`;

export const EXPIRY_REMINDER_DAYS = Math.max(
	0,
	Number(process.env.COIN_EXPIRY_REMINDER_DAYS ?? process.env.EXPIRY_REMINDER_DAYS ?? 3),
);
export const SCHEDULER_INTERVAL_MS = Math.max(
	5000,
	Number(process.env.COIN_EXPIRY_REMINDER_SCHEDULER_INTERVAL_MS ?? process.env.SCHEDULER_INTERVAL_MS ?? 10000),
);
export const MAX_RETRY = Math.max(
	1,
	Number(process.env.COIN_EXPIRY_REMINDER_MAX_RETRY ?? process.env.MAX_RETRY ?? 3),
);

export const REMINDER_DISPATCH_BUFFER_MS = Math.max(
	1000,
	Number(process.env.COIN_EXPIRY_REMINDER_DISPATCH_BUFFER_MS ?? 60 * 1000),
);
export const REMINDER_DISPATCH_LOCK_TTL_SECONDS = Math.max(
	10,
	Number(process.env.COIN_EXPIRY_REMINDER_DISPATCH_LOCK_TTL_SECONDS ?? 90),
);
export const REMINDER_PROCESS_LOCK_TTL_SECONDS = Math.max(
	30,
	Number(process.env.COIN_EXPIRY_REMINDER_PROCESS_LOCK_TTL_SECONDS ?? 300),
);

export const COIN_EXPIRY_DAY_MS = 24 * 60 * 60 * 1000;
