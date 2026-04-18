import type { NotificationMap, NotificationType } from '../dto/notification-payload.dto';
import type { NotificationHandler } from './notification-handler.interface';

export type HandlerRegistry = {
  [K in NotificationType]: NotificationHandler<NotificationMap[K]>;
};
