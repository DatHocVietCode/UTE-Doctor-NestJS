import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers['authorization'];

    if (!authHeader) {
      console.log('Authorization header missing');
      throw new UnauthorizedException('Missing Authorization header');
    }

    const [bearer, token] = authHeader.split(' ');
    if (bearer !== 'Bearer' || !token) {
      console.log('Invalid token format');
      throw new UnauthorizedException('Invalid token format');
    }

    try {
      console.log('Verifying token:', token);
      const payload = await this.jwtService.verifyAsync(token, {
        secret: process.env.JWT_SECRET,
      });
      console.log('Token verified successfully:', payload);
      request.user = payload;
      return true;
    } catch (error) {
      console.log('Invalid or expired token', error);
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
