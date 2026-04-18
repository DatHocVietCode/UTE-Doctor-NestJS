import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Socket } from 'socket.io';
import { AuthUser } from 'src/common/interfaces/auth-user';

/**
 * Type definition for JWT payload stored in socket.data.authUser
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
 * User data is attached by SocketAuthMiddleware and consumed by gateway handlers
 * 
 * @example
 * ```typescript
 * @SubscribeMessage('event')
 * handleEvent(@WsUser() user: JwtSocketPayload) {
 *   console.log(user.accountId);
 * }
 * ```
 */
// export const WsUser = createParamDecorator(
//   (data: string | undefined, ctx: ExecutionContext): JwtSocketPayload => {
//     const client = ctx.switchToWs().getClient<Socket>();
//     const user = (client.data as any).user as JwtSocketPayload;

//     if (!user) {
//       throw new Error('User not found in socket data. JWT verification may have failed.');
//     }

//     // Return specific field if requested, otherwise return full user object
//     return data ? (user as any)[data] : user;
//   },
// );
// import { AuthUser } from '...'; // import đúng path

export const WsUser = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext): AuthUser => {
    const client = ctx.switchToWs().getClient<Socket>();
    const rawUser = (client.data as any).authUser;

    if (!rawUser) {
      throw new Error('User not found in socket data. JWT verification may have failed.');
    }

    const user: AuthUser = {
      accountId: rawUser.accountId || rawUser.sub,
      email: rawUser.email,
      role: rawUser.role,
      patientId: rawUser.patientId,
      doctorId: rawUser.doctorId,
      profileId: rawUser.profileId,
      sub: rawUser.sub,
      iat: rawUser.iat,
      exp: rawUser.exp,
    };

    return data ? (user as any)[data] : user;
  },
);