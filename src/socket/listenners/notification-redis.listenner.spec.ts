import { SocketEventsEnum } from 'src/common/enum/socket-events.enum';
import { NOTIFICATION_REDIS_CHANNEL } from 'src/notification/notification.constants';
import type { StoredNotificationPayload } from 'src/notification/notification-payload.mapper';
import { NotificationRedisListener } from './notification-redis.listenner';

type SubscribeHandler = (payload: StoredNotificationPayload) => void;

describe('NotificationRedisListener', () => {
  let subscribeHandler: SubscribeHandler | undefined;
  let redisService: { subscribe: jest.Mock; unsubscribe: jest.Mock };
  let notificationGateway: { emitToRoom: jest.Mock };
  let listener: NotificationRedisListener;

  beforeEach(() => {
    subscribeHandler = undefined;
    redisService = {
      subscribe: jest
        .fn()
        .mockImplementation((_channel: string, handler: SubscribeHandler) => {
          subscribeHandler = handler;
          return Promise.resolve();
        }),
      unsubscribe: jest.fn().mockResolvedValue(undefined),
    };
    notificationGateway = { emitToRoom: jest.fn() };
    listener = new NotificationRedisListener(
      redisService as never,
      notificationGateway as never,
    );
  });

  it('emits the saved structured notification payload to the saved recipient room only', async () => {
    const payload: StoredNotificationPayload = {
      _id: 'notification-1',
      type: 'APPOINTMENT_SUCCESS',
      recipientEmail: 'patient@example.com',
      recipientRole: 'PATIENT',
      title: 'Đặt lịch khám thành công',
      message: 'Bạn có thông báo lịch khám mới.',
      titleKey: 'notification.patient.appointmentSuccess.title',
      messageKey: 'notification.patient.appointmentSuccess.message',
      data: {
        appointmentId: 'appointment-1',
        appointmentDate: 1700000000000,
        timeRange: '09:00-09:30',
      },
      isRead: false,
      createdAt: 1700000001000,
      idempotencyKey: 'appointment-success:appointment-1:patient@example.com',
    };

    await listener.onModuleInit();
    subscribeHandler?.(payload);

    expect(redisService.subscribe).toHaveBeenCalledWith(
      NOTIFICATION_REDIS_CHANNEL,
      expect.any(Function),
    );
    expect(notificationGateway.emitToRoom).toHaveBeenCalledTimes(1);
    expect(notificationGateway.emitToRoom).toHaveBeenCalledWith(
      'patient@example.com',
      SocketEventsEnum.NOTIFICATION_RECEIVED,
      payload,
    );
  });

  it('skips malformed payloads without a recipient email', async () => {
    await listener.onModuleInit();
    subscribeHandler?.({
      _id: 'notification-2',
      data: {},
      isRead: false,
      createdAt: 1700000001000,
    });

    expect(notificationGateway.emitToRoom).not.toHaveBeenCalled();
  });

  it('unsubscribes from the notification channel on destroy', async () => {
    await listener.onModuleDestroy();

    expect(redisService.unsubscribe).toHaveBeenCalledWith(
      NOTIFICATION_REDIS_CHANNEL,
    );
  });
});
