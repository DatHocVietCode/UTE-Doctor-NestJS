import { SocketEventsEnum } from 'src/common/enum/socket-events.enum';
import { BaseGateway } from './base.gateway';

// Flush pending microtasks/macrotasks so the fire-and-forget auto-join completes.
const flush = () => new Promise((resolve) => setImmediate(resolve));

type FakeSocket = {
  id: string;
  nsp: { name: string };
  data: { userId?: string; authUser?: { email?: string; role?: string } };
  join: jest.Mock;
  emit: jest.Mock;
  disconnect: jest.Mock;
};

function makeClient(overrides: Partial<FakeSocket> = {}): FakeSocket {
  return {
    id: 'socket-1',
    nsp: { name: '/notification' },
    data: {
      userId: 'user-1',
      authUser: { email: 'Recep@Example.com', role: 'RECEPTIONIST' },
    },
    join: jest.fn().mockResolvedValue(undefined),
    emit: jest.fn(),
    disconnect: jest.fn(),
    ...overrides,
  };
}

describe('BaseGateway', () => {
  let gateway: BaseGateway;
  let presenceService: {
    addConnection: jest.Mock;
    removeConnection: jest.Mock;
    refreshTTL: jest.Mock;
  };
  let socketRoomService: { joinRoom: jest.Mock };

  beforeEach(() => {
    presenceService = {
      addConnection: jest.fn().mockResolvedValue(undefined),
      removeConnection: jest.fn().mockResolvedValue(undefined),
      refreshTTL: jest.fn().mockResolvedValue(undefined),
    };
    socketRoomService = { joinRoom: jest.fn().mockResolvedValue(undefined) };
    gateway = new BaseGateway(
      socketRoomService as never,
      presenceService as never,
    );
  });

  describe('handleConnection auto-join', () => {
    it('registers presence and auto-joins the normalized (lowercased) email room', async () => {
      const client = makeClient();

      gateway.handleConnection(client as never);
      await flush();

      // Raw (un-normalized) email/role metadata is forwarded; PresenceService normalizes it.
      expect(presenceService.addConnection).toHaveBeenCalledWith(
        'user-1',
        'socket-1',
        {
          email: 'Recep@Example.com',
          role: 'RECEPTIONIST',
        },
      );
      expect(client.join).toHaveBeenCalledWith('recep@example.com');
    });

    it('normalizes email by trimming and lowercasing before joining', async () => {
      const client = makeClient({
        data: {
          userId: 'user-2',
          authUser: { email: '  MixedCase@Mail.COM  ' },
        },
      });

      gateway.handleConnection(client as never);
      await flush();

      expect(client.join).toHaveBeenCalledWith('mixedcase@mail.com');
    });

    it('still registers presence but does not join an email room when email is missing', async () => {
      const client = makeClient({ data: { userId: 'user-3', authUser: {} } });

      gateway.handleConnection(client as never);
      await flush();

      expect(presenceService.addConnection).toHaveBeenCalledWith(
        'user-3',
        'socket-1',
        {
          email: undefined,
          role: undefined,
        },
      );
      expect(client.join).not.toHaveBeenCalled();
    });

    it('disconnects and skips presence/join for an unauthenticated socket', async () => {
      const client = makeClient({ data: {} });

      gateway.handleConnection(client as never);
      await flush();

      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(presenceService.addConnection).not.toHaveBeenCalled();
      expect(client.join).not.toHaveBeenCalled();
    });
  });

  describe('handleDisconnect', () => {
    it('delegates to presence removal using the socket id', () => {
      const client = makeClient();

      gateway.handleDisconnect(client as never);

      expect(presenceService.removeConnection).toHaveBeenCalledWith(
        'user-1',
        'socket-1',
      );
    });
  });

  describe('handleHeartbeat', () => {
    it('refreshes presence TTL and forwards role metadata', async () => {
      const client = makeClient();

      await gateway.handleHeartbeat(client as never);

      expect(presenceService.refreshTTL).toHaveBeenCalledWith(
        'user-1',
        'socket-1',
        '/notification',
        {
          email: 'Recep@Example.com',
          role: 'RECEPTIONIST',
        },
      );
    });
  });

  describe('JOIN_ROOM backward compatibility', () => {
    it('joins the JWT email room and emits ROOM_JOINED', async () => {
      const client = makeClient({
        data: { userId: 'user-1', authUser: { email: 'Recep@Example.com' } },
      });

      await gateway.handleJoinRoom(client as never);

      expect(client.join).toHaveBeenCalledWith('recep@example.com');
      expect(client.emit).toHaveBeenCalledWith(SocketEventsEnum.ROOM_JOINED, {
        email: 'recep@example.com',
      });
    });
  });

  describe('emitToRoom', () => {
    it('emits to the normalized email room via the server', () => {
      const emit = jest.fn();
      const to = jest.fn().mockReturnValue({ emit });
      (
        gateway as unknown as { server: { emit: jest.Mock; to: jest.Mock } }
      ).server = {
        emit: jest.fn(),
        to,
      };

      gateway.emitToRoom(
        'Recep@Example.com',
        SocketEventsEnum.NOTIFICATION_RECEIVED,
        { hello: 'world' },
      );

      expect(to).toHaveBeenCalledWith('recep@example.com');
      expect(emit).toHaveBeenCalledWith(
        SocketEventsEnum.NOTIFICATION_RECEIVED,
        { hello: 'world' },
      );
    });
  });
});
