import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Socket } from 'socket.io';

@Injectable()
export class WsJwtGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const client: Socket = context.switchToWs().getClient<Socket>();
    const tokenFromAuth = (client.handshake as any)?.auth?.token as string | undefined;
    const headerAuth = client.handshake.headers?.authorization as string | undefined;
    const token = tokenFromAuth || (headerAuth?.startsWith('Bearer ') ? headerAuth.substring(7) : undefined);
    if (!token) {
        console.log('No token provided in socket connection');
      throw new UnauthorizedException('Missing socket auth token');
    }
    try {
      const payload = await this.jwtService.verifyAsync(token, { secret: process.env.JWT_SECRET });
      (client.data as any).user = payload;
      return true;
    } catch (e) {
        console.log('Invalid token in socket connection', e);   
      throw new UnauthorizedException('Invalid or expired socket token');
    }
  }
}