import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Socket } from 'socket.io';

/**
 * Type definition for JWT payload stored in socket.data.user
 */
export interface JwtSocketPayload {
  accountId?: string;
  sub?: string;
  email?: string;
  role?: string;
  iat?: number;
  exp?: number;
}

/**
 * Custom decorator to extract authenticated user from WebSocket connection
 * User data is attached to socket.data.user during JWT verification in afterInit
 * 
 * @example
 * ```typescript
 * @SubscribeMessage('event')
 * handleEvent(@WsUser() user: JwtSocketPayload) {
 *   console.log(user.accountId);
 * }
 * ```
 */
export const WsUser = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext): JwtSocketPayload => {
    const client = ctx.switchToWs().getClient<Socket>();
    const user = (client.data as any).user as JwtSocketPayload;

    if (!user) {
      throw new Error('User not found in socket data. JWT verification may have failed.');
    }

    // Return specific field if requested, otherwise return full user object
    return data ? (user as any)[data] : user;
  },
);
