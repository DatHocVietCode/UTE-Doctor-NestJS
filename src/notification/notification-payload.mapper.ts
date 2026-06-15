import type { NotificationType } from './dto/notification-payload.dto';
import type { NotificationDocument } from './schemas/notification.schema';

type PlainNotification = Record<string, unknown>;

export type StoredNotificationPayload = {
  _id: string;
  type?: NotificationType;
  recipientEmail?: string;
  recipientRole?: string;
  title?: string;
  message?: string;
  titleKey?: string;
  messageKey?: string;
  data: Record<string, unknown>;
  isRead: boolean;
  createdAt: number | null;
  idempotencyKey?: string;
};

function toEpoch(value: unknown): number | null {
  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.floor(value);
  }

  if (typeof value === 'string') {
    const parsed = new Date(value).getTime();
    return Number.isNaN(parsed) ? null : parsed;
  }

  return null;
}

function hasToObject(
  notification: unknown,
): notification is { toObject: () => PlainNotification } {
  return (
    typeof notification === 'object' &&
    notification !== null &&
    typeof (notification as { toObject?: unknown }).toObject === 'function'
  );
}

function asPlain(notification: unknown): PlainNotification {
  if (hasToObject(notification)) {
    return notification.toObject();
  }

  return typeof notification === 'object' && notification !== null
    ? (notification as PlainNotification)
    : {};
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function idToString(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return value.toString();
  }

  if (typeof value === 'object' && value !== null) {
    const toHexString = (value as { toHexString?: () => unknown }).toHexString;
    if (typeof toHexString === 'function') {
      const hex = toHexString();
      return typeof hex === 'string' ? hex : '';
    }
  }

  return '';
}

function recordOrEmpty(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function toStoredNotificationPayload(
  notification: NotificationDocument | PlainNotification,
): StoredNotificationPayload {
  const plain = asPlain(notification);

  return {
    _id: idToString(plain._id),
    type: stringOrUndefined(plain.type) as NotificationType | undefined,
    recipientEmail: stringOrUndefined(plain.recipientEmail),
    recipientRole: stringOrUndefined(plain.recipientRole),
    title: stringOrUndefined(plain.title),
    message: stringOrUndefined(plain.message),
    titleKey: stringOrUndefined(plain.titleKey),
    messageKey: stringOrUndefined(plain.messageKey),
    data: recordOrEmpty(plain.data ?? plain.details),
    isRead: Boolean(plain.isRead),
    createdAt: toEpoch(plain.createdAt),
    idempotencyKey: stringOrUndefined(plain.idempotencyKey),
  };
}
