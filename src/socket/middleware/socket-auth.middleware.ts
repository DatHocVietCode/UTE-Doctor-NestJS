import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Socket } from 'socket.io';
import { AuthUser } from 'src/common/interfaces/auth-user';

@Injectable()
export class SocketAuthMiddleware {
  private readonly logger = new Logger(SocketAuthMiddleware.name);

  constructor(private readonly jwtService: JwtService) {}

  async use(socket: Socket, next: (err?: Error) => void): Promise<void> {
    try {
      const token = socket.handshake.auth?.token as string | undefined;

      this.logger.log(
        `Authenticating socket connection namespace=${socket.nsp.name} socketId=${socket.id} hasToken=${Boolean(token)}`,
      );

      if (!token) {
        this.logger.warn(
          `Socket auth rejected namespace=${socket.nsp.name} socketId=${socket.id} reason=missing_token`,
        );
        return next(new UnauthorizedException('Missing auth token'));
      }

      const payload = await this.jwtService.verifyAsync<AuthUser>(token, {
        secret: process.env.JWT_SECRET,
      });
      const userId = payload.accountId || payload.sub;

      if (!userId) {
        this.logger.warn(
          `Socket auth rejected namespace=${socket.nsp.name} socketId=${socket.id} reason=invalid_token_payload`,
        );
        return next(new UnauthorizedException('Invalid token payload'));
      }

      // Keep the lifecycle layer keyed by userId while preserving the normalized auth payload for existing socket handlers.
      socket.data.userId = String(userId);
      socket.data.authUser = {
        accountId: String(userId),
        email: payload.email,
        role: payload.role,
        patientId: payload.patientId,
        doctorId: payload.doctorId,
        profileId: payload.profileId,
        sub: payload.sub || String(userId),
        iat: payload.iat,
        exp: payload.exp,
      } satisfies AuthUser;

      this.logger.log(
        `Socket auth accepted namespace=${socket.nsp.name} socketId=${socket.id} userId=${String(userId)}`,
      );

      next();
    } catch (error) {
      this.logger.warn(
        `Socket auth rejected namespace=${socket.nsp.name} socketId=${socket.id} reason=${(error as Error).message}`,
      );
      return next(new UnauthorizedException('Invalid or expired token'));
    }
  }
}