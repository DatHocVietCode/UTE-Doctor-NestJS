import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from 'src/common/redis/redis.service';
import { AppointmentService } from './appointment.service';
import { CancellationActor } from './enums/cancellation-actor.enum';
import { NoShowSource } from './enums/no-show-source.enum';
import {
  NO_SHOW_LOCK_KEY,
  NO_SHOW_LOCK_TTL_SECONDS,
  NO_SHOW_STARTUP_DELAY_MS,
  NoShowConfig,
  resolveNoShowConfig,
} from './no-show.config';
import { AppointmentTimeHelper } from './utils/appointment-time.helper';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * No-show lifecycle reconciler. Settles overdue CONFIRMED appointments (patient never
 * checked in) to NO_SHOW. Runs as a startup catch-up (after restart/deploy) and a daily
 * 06:00 Asia/Ho_Chi_Minh pass — deliberately NOT a high-frequency sweep, so side effects
 * stay humane. Restart-safe (state lives in MongoDB), Redis-locked so one instance acts
 * per run. All eligibility/idempotency lives in AppointmentService.markAppointmentNoShow.
 *
 * Vietnam has no DST, so the fixed +7h offset makes 06:00 scheduling exact without a
 * scheduling dependency. See docs/no-show-lifecycle-reconciliation-plan.md.
 */
@Injectable()
export class NoShowReconcilerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NoShowReconcilerService.name);
  private readonly noShowConfig: NoShowConfig;
  private startupTimer?: NodeJS.Timeout;
  private dailyTimer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly redisService: RedisService,
    private readonly appointmentService: AppointmentService,
    private readonly config: ConfigService,
  ) {
    this.noShowConfig = resolveNoShowConfig((key) => this.config.get(key));
  }

  onModuleInit(): void {
    this.startupTimer = setTimeout(() => {
      void this.reconcile(NoShowSource.STARTUP);
    }, NO_SHOW_STARTUP_DELAY_MS);
    this.scheduleNextDaily();
  }

  onModuleDestroy(): void {
    if (this.startupTimer) clearTimeout(this.startupTimer);
    if (this.dailyTimer) clearTimeout(this.dailyTimer);
  }

  private scheduleNextDaily(): void {
    const delay = this.msUntilNextDailyRun(Date.now());
    this.dailyTimer = setTimeout(() => {
      void this.reconcile(NoShowSource.DAILY_06AM).finally(() => this.scheduleNextDaily());
    }, delay);
  }

  /** ms from `now` until the next local dailyHour:00 (Asia/Ho_Chi_Minh, fixed +7, no DST). */
  msUntilNextDailyRun(now: number): number {
    const offsetMs = AppointmentTimeHelper.DEFAULT_OFFSET_MINUTES * 60_000;
    // A Date whose UTC fields read as Asia/Ho_Chi_Minh local time.
    const target = new Date(now + offsetMs);
    target.setUTCHours(this.noShowConfig.dailyHour, 0, 0, 0);
    let targetMs = target.getTime() - offsetMs; // back to a real UTC epoch
    if (targetMs <= now) targetMs += DAY_MS;
    return targetMs - now;
  }

  /** One reconciliation pass. Public so tests can invoke it directly. */
  async reconcile(source: NoShowSource, now: number = Date.now()): Promise<void> {
    if (this.running) return;
    this.running = true;

    const lockValue = `${process.pid}:${now}`;
    const acquired = await this.redisService.acquireSlotLock(NO_SHOW_LOCK_KEY, lockValue, NO_SHOW_LOCK_TTL_SECONDS);
    if (!acquired) {
      this.running = false;
      return;
    }

    try {
      const ids = await this.appointmentService.findNoShowCandidateIds(now);
      let marked = 0;
      for (const appointmentId of ids) {
        const res = await this.appointmentService.markAppointmentNoShow(
          { appointmentId, actor: CancellationActor.SYSTEM, source },
          now,
        );
        if (res.noShow) marked++;
      }
      const emailed = await this.appointmentService.processDeferredNoShowEmails(now);
      if (marked || emailed) {
        this.logger.log(`No-show reconcile (${source}): marked=${marked}, deferredEmails=${emailed}`);
      }
    } catch (error) {
      this.logger.error(`No-show reconcile failed: ${(error as Error).message}`);
    } finally {
      await this.redisService.releaseSlotLock(NO_SHOW_LOCK_KEY, lockValue);
      this.running = false;
    }
  }
}
