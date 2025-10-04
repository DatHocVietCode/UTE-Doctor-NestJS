import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

@Injectable()
export class AuthSaga {
  // nghe event từ AuthService
  @OnEvent('user.register.requested')
  async handleRegister(payload: any) {
    const { requestId, dto } = payload;

    console.log('Saga start for:', dto.email);

    // giả lập xử lý async (call DB, service ngoài…)
    await new Promise((resolve) => setTimeout(resolve, 3000));

    if (dto.email.includes('fail')) {
      // fail
      global.eventEmitter.emit('user.register.failed', {
        requestId,
        dto,
        error: 'Email not allowed',
      });
    } else {
      // success
      global.eventEmitter.emit('user.register.success', {
        requestId,
        dto,
        account: { id: Date.now(), email: dto.email },
      });
    }
  }
}
