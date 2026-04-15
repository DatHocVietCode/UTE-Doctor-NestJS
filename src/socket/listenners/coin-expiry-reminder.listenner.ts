import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DataResponse } from 'src/common/dto/data-respone';
import { ResponseCode } from 'src/common/enum/reponse-code.enum';
import { SocketEventsEnum } from 'src/common/enum/socket-events.enum';
import { RedisService } from 'src/common/redis/redis.service';
import { BaseGateway } from 'src/socket/base/base.gateway';
import { COIN_EXPIRY_REMINDER_REDIS_CHANNEL } from 'src/wallet/coin/coin-expiry-reminder/coin-expiry-reminder.constants';
import { CoinExpiryReminderEventPayload } from 'src/wallet/coin/coin-expiry-reminder/dto/coin-expiry-reminder.dto';

@Injectable()
export class CoinExpiryReminderSocketListener implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CoinExpiryReminderSocketListener.name);

  constructor(
    private readonly redisService: RedisService,
    private readonly baseGateway: BaseGateway,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.redisService.subscribe(COIN_EXPIRY_REMINDER_REDIS_CHANNEL, async (payload: CoinExpiryReminderEventPayload) => {
      if (!payload?.patientEmail) {
        return;
      }

      const response: DataResponse = {
        code: ResponseCode.SUCCESS,
        message: 'Coin expiry reminder',
        data: payload,
      };

      this.baseGateway.emitToRoom(payload.patientEmail, SocketEventsEnum.COIN_EXPIRY_REMINDER, response);
      this.logger.log(`Pushed coin expiry reminder to room ${payload.patientEmail}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.redisService.unsubscribe(COIN_EXPIRY_REMINDER_REDIS_CHANNEL);
  }
}
