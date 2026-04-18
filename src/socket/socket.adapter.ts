import { INestApplicationContext, Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { ServerOptions } from 'socket.io';
import { SocketAuthMiddleware } from './middleware/socket-auth.middleware';

export class SocketAdapter extends IoAdapter {
  private readonly logger = new Logger(SocketAdapter.name);

  constructor(
    app: INestApplicationContext,
    private readonly socketAuthMiddleware: SocketAuthMiddleware,
  ) {
    super(app);
  }

  createIOServer(port: number, options?: ServerOptions) {
    const server = super.createIOServer(port, options);

    const applyAuthMiddleware = (socket: any, next: (err?: Error) => void) => {
      this.socketAuthMiddleware.use(socket, next);
    };

    // Register auth on root namespace.
    server.use(applyAuthMiddleware);

    // Also register auth explicitly per namespace to avoid missing middleware on namespaced gateways.
    const knownNamespaces = [
      '/auth',
      '/appointment',
      '/appointment/fields-data',
      '/chat',
      '/notification',
      '/patient-profile',
      '/payment/vnpay',
    ];

    for (const namespace of knownNamespaces) {
      server.of(namespace).use(applyAuthMiddleware);
    }

    this.logger.log(
      `Socket auth middleware attached on root and namespaces: ${knownNamespaces.join(', ')}`,
    );

    return server;
  }
}