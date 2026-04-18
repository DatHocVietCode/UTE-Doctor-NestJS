export type NotificationHandlerMeta = {
  recipientEmail: string;
  createdAt: number;
  idempotencyKey: string;
};

export interface NotificationHandler<TPayload> {
  handle(payload: TPayload, meta: NotificationHandlerMeta): Promise<void>;
}
