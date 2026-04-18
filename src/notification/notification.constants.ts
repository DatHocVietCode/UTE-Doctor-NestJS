export const NOTIFICATION_JOBS_QUEUE =
  process.env.NOTIFICATION_JOBS_QUEUE?.trim() || 'notification.jobs';

export const NOTIFICATION_JOBS_EXCHANGE =
  process.env.NOTIFICATION_JOBS_EXCHANGE?.trim() || 'notification.jobs';

export const NOTIFICATION_JOBS_DLX_EXCHANGE = `${NOTIFICATION_JOBS_EXCHANGE}.dlx`;
export const NOTIFICATION_JOBS_DLQ = `${NOTIFICATION_JOBS_QUEUE}.dlq`;
export const NOTIFICATION_JOBS_QUEUE_OPTIONS = {
  durable: true,
  deadLetterExchange: NOTIFICATION_JOBS_DLX_EXCHANGE,
  deadLetterRoutingKey: NOTIFICATION_JOBS_DLQ,
};

export const NOTIFICATION_REDIS_CHANNEL =
  process.env.NOTIFICATION_REDIS_CHANNEL?.trim() || 'notification';

export const NOTIFICATION_MAX_RETRY = Math.max(
  1,
  Number(process.env.NOTIFICATION_MAX_RETRY ?? 3),
);
