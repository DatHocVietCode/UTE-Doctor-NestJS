import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { RedisService } from 'src/common/redis/redis.service';
import {
  AssignmentSlaConfig,
  resolveAssignmentSlaConfig,
  SLA_BATCH_LIMIT,
  SLA_LOCK_KEY,
  SLA_LOCK_TTL_SECONDS,
  SLA_SWEEP_INTERVAL_MS,
} from './appointment-assignment-sla.config';
import { AssignmentTaskStatus } from './enums/assignment-task-status.enum';
import {
  AppointmentAssignmentTask,
  AppointmentAssignmentTaskDocument,
} from './schemas/appointment-assignment-task.schema';

/**
 * SLA sweep for assignment tasks (MVP). Mirrors the project's setInterval scheduler
 * pattern (no @nestjs/schedule dependency) and guards each run with a Redis lock so
 * only one instance acts per tick.
 *
 * It deliberately depends ONLY on the task model, Redis, the event bus, and config —
 * it has no appointment/payment/credit dependency, so it cannot auto-cancel an
 * appointment or auto-refund a deposit.
 */
@Injectable()
export class AssignmentSlaScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AssignmentSlaScheduler.name);
  private readonly slaConfig: AssignmentSlaConfig;
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    @InjectModel(AppointmentAssignmentTask.name)
    private readonly taskModel: Model<AppointmentAssignmentTaskDocument>,
    private readonly redisService: RedisService,
    private readonly eventEmitter: EventEmitter2,
    private readonly config: ConfigService,
  ) {
    this.slaConfig = resolveAssignmentSlaConfig((key) => this.config.get(key));
  }

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.runSlaSweep();
    }, SLA_SWEEP_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /** One SLA pass. Public so it can be invoked directly in tests. */
  async runSlaSweep(): Promise<void> {
    // Within an instance, runs are serialized; across instances, the Redis lock wins.
    if (this.running) {
      return;
    }
    this.running = true;

    const lockValue = `${process.pid}:${Date.now()}`;
    const acquired = await this.redisService.acquireSlotLock(SLA_LOCK_KEY, lockValue, SLA_LOCK_TTL_SECONDS);
    if (!acquired) {
      this.running = false;
      return;
    }

    try {
      const now = Date.now();
      await this.sendReminders(now);
      await this.expireOverdue(now);
      await this.reclaimStaleAccepted(now);
    } catch (error) {
      this.logger.error(`Assignment SLA sweep failed: ${(error as Error).message}`);
    } finally {
      await this.redisService.releaseSlotLock(SLA_LOCK_KEY, lockValue);
      this.running = false;
    }
  }

  // Remind for PENDING tasks within the reminder window and not reminded too recently.
  private async sendReminders(now: number): Promise<void> {
    const candidates = await this.taskModel
      .find({
        status: AssignmentTaskStatus.PENDING,
        deadlineAt: { $gt: now, $lte: now + this.slaConfig.reminderWindowMs },
        $or: [
          { lastNotifiedAt: { $exists: false } },
          { lastNotifiedAt: null },
          { lastNotifiedAt: { $lte: now - this.slaConfig.reminderIntervalMs } },
        ],
      })
      .limit(SLA_BATCH_LIMIT)
      .lean();

    for (const task of candidates) {
      // Conditional update bumps reminder bookkeeping; the lastNotifiedAt gate prevents spam.
      const res = await this.taskModel.updateOne(
        { _id: task._id, status: AssignmentTaskStatus.PENDING },
        { $set: { lastNotifiedAt: now }, $inc: { reminderCount: 1 } },
      );
      if (res.modifiedCount > 0) {
        this.eventEmitter.emit('appointment.assignment.reminder', {
          taskId: task._id.toString(),
          appointmentId: task.appointmentId?.toString(),
          deadlineAt: task.deadlineAt,
          reminderCount: (task.reminderCount ?? 0) + 1,
        });
      }
    }
  }

  // Expire PENDING tasks past deadline + grace. MVP: mark EXPIRED (no escalation,
  // no auto-cancel, no auto-refund). Appointment is left for manual handling.
  private async expireOverdue(now: number): Promise<void> {
    const overdue = await this.taskModel
      .find({
        status: AssignmentTaskStatus.PENDING,
        deadlineAt: { $lte: now - this.slaConfig.graceMs },
      })
      .limit(SLA_BATCH_LIMIT)
      .lean();

    for (const task of overdue) {
      const res = await this.taskModel.updateOne(
        { _id: task._id, status: AssignmentTaskStatus.PENDING },
        {
          $set: { status: AssignmentTaskStatus.EXPIRED },
          $push: {
            history: {
              at: now,
              from: AssignmentTaskStatus.PENDING,
              to: AssignmentTaskStatus.EXPIRED,
              by: 'system',
              note: 'deadline passed',
            },
          },
        },
      );
      if (res.modifiedCount > 0) {
        this.eventEmitter.emit('appointment.assignment.expired', {
          taskId: task._id.toString(),
          appointmentId: task.appointmentId?.toString(),
          deadlineAt: task.deadlineAt,
        });
      }
    }
  }

  // Return ASSIGNED tasks abandoned past the accept TTL to the PENDING pool.
  private async reclaimStaleAccepted(now: number): Promise<void> {
    const cutoff = now - this.slaConfig.acceptTtlMs;
    const stale = await this.taskModel
      .find({ status: AssignmentTaskStatus.ASSIGNED, acceptedAt: { $lte: cutoff } })
      .limit(SLA_BATCH_LIMIT)
      .lean();

    for (const task of stale) {
      await this.taskModel.updateOne(
        { _id: task._id, status: AssignmentTaskStatus.ASSIGNED, acceptedAt: { $lte: cutoff } },
        {
          $set: { status: AssignmentTaskStatus.PENDING },
          $unset: { acceptedByReceptionistId: '', acceptedAt: '' },
          $push: {
            history: {
              at: now,
              from: AssignmentTaskStatus.ASSIGNED,
              to: AssignmentTaskStatus.PENDING,
              by: 'system',
              note: 'stale accept reclaimed',
            },
          },
        },
      );
    }
  }
}
