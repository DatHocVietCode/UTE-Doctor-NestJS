import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { BillingService } from './billing.service';

@Injectable()
export class BillingListener {
  private readonly logger = new Logger(BillingListener.name);
  constructor(private readonly billingService: BillingService) {}

  @OnEvent('domain.visit.completed')
  async handleVisitCompleted(payload: { visitId: string; encounterId?: string; completedAt?: number }) {
    try {
      if (!payload || !payload.visitId) {
        this.logger.warn('domain.visit.completed received without visitId');
        return;
      }

      await this.billingService.createDraftBilling(payload.visitId);
    } catch (err) {
      this.logger.error(`Failed to create billing for visit ${payload.visitId}: ${String(err)}`);
    }
  }
}
