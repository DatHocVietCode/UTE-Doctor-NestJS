import type { NotificationRecipientRole } from '../dto/notification-payload.dto';

export type NotificationHandlerMeta = {
  recipientEmail: string;
  recipientRole: NotificationRecipientRole;
  createdAt: number;
  idempotencyKey: string;
};

export interface NotificationHandler<TPayload> {
  handle(payload: TPayload, meta: NotificationHandlerMeta): Promise<void>;
}
