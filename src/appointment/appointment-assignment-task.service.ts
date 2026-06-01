import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { DataResponse } from 'src/common/dto/data-respone';
import { ResponseCode } from 'src/common/enum/reponse-code.enum';
import { AssignmentTaskStatus } from './enums/assignment-task-status.enum';
import {
  AppointmentAssignmentTask,
  AppointmentAssignmentTaskDocument,
  AssignmentTaskHistoryEntry,
} from './schemas/appointment-assignment-task.schema';

export interface ListAssignmentTasksQuery {
  status?: string;
  specialty?: string;
  page?: number;
  limit?: number;
}

/**
 * Receptionist-facing queue management for broad-appointment assignment tasks.
 *
 * Batch 3 scope: list / detail / accept / release. No doctor-slot assignment,
 * no cron/SLA, no notification fan-out yet.
 */
@Injectable()
export class AppointmentAssignmentTaskService {
  private readonly logger = new Logger(AppointmentAssignmentTaskService.name);

  constructor(
    @InjectModel(AppointmentAssignmentTask.name)
    private readonly taskModel: Model<AppointmentAssignmentTaskDocument>,
  ) {}

  async listTasks(query: ListAssignmentTasksQuery): Promise<DataResponse> {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.max(1, Math.min(100, Number(query.limit) || 20));
    const status = query.status || AssignmentTaskStatus.PENDING;

    const filter: FilterQuery<AppointmentAssignmentTaskDocument> = { status };
    if (query.specialty) {
      filter.specialty = query.specialty;
    }

    const [items, total] = await Promise.all([
      this.taskModel
        .find(filter)
        // Oldest-first within a status so the queue is processed fairly (FIFO).
        .sort({ createdAt: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      this.taskModel.countDocuments(filter),
    ]);

    return {
      code: ResponseCode.SUCCESS,
      message: 'Fetched assignment tasks successfully',
      data: {
        items,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    };
  }

  async getTaskDetail(taskId: string): Promise<DataResponse> {
    const task = await this.findByIdOrThrow(taskId);
    return {
      code: ResponseCode.SUCCESS,
      message: 'Fetched assignment task successfully',
      data: task,
    };
  }

  /**
   * Atomically lock a PENDING task to the calling receptionist. The single
   * conditional findOneAndUpdate guarantees exactly one winner under concurrent
   * accepts; a null result means the caller lost the race (or the task moved on).
   */
  async acceptTask(taskId: string, receptionistId: string): Promise<DataResponse> {
    this.assertValidId(taskId);
    const acceptorId = this.toReceptionistId(receptionistId);
    const now = Date.now();

    const updated = await this.taskModel.findOneAndUpdate(
      { _id: taskId, status: AssignmentTaskStatus.PENDING },
      {
        $set: {
          status: AssignmentTaskStatus.ASSIGNED,
          acceptedByReceptionistId: acceptorId,
          acceptedAt: now,
        },
        $push: {
          history: this.historyEntry(
            now,
            AssignmentTaskStatus.PENDING,
            AssignmentTaskStatus.ASSIGNED,
            receptionistId,
            'accepted',
          ),
        },
      },
      { new: true },
    );

    if (!updated) {
      // Disambiguate the failure for the FE.
      const existing = await this.taskModel.findById(taskId).select('status').lean();
      if (!existing) {
        this.throwBlocked('TASK_NOT_FOUND', 'Assignment task not found', true);
      }
      if (existing!.status === AssignmentTaskStatus.ASSIGNED) {
        this.throwBlocked('TASK_ALREADY_ACCEPTED', 'Assignment task has already been accepted');
      }
      this.throwBlocked(
        'TASK_NOT_PENDING',
        `Assignment task is not pending (current status: ${existing!.status})`,
      );
    }

    this.logger.log(`[Assignment] task=${taskId} accepted by receptionist=${receptionistId}`);

    return {
      code: ResponseCode.SUCCESS,
      message: 'Assignment task accepted',
      data: {
        taskId: updated!._id.toString(),
        status: updated!.status,
        acceptedByReceptionistId: updated!.acceptedByReceptionistId?.toString(),
        acceptedAt: updated!.acceptedAt,
      },
    };
  }

  /**
   * Return an accepted task to the pool. Only the receptionist who accepted it
   * may release it; the conditional update enforces ownership + status atomically.
   */
  async releaseTask(taskId: string, receptionistId: string, reason?: string): Promise<DataResponse> {
    this.assertValidId(taskId);

    const task = await this.taskModel.findById(taskId).select('status acceptedByReceptionistId').lean();
    if (!task) {
      this.throwBlocked('TASK_NOT_FOUND', 'Assignment task not found', true);
    }
    if (task!.status !== AssignmentTaskStatus.ASSIGNED) {
      this.throwBlocked(
        'TASK_NOT_ASSIGNED',
        `Assignment task is not in an assigned state (current status: ${task!.status})`,
      );
    }
    if (task!.acceptedByReceptionistId?.toString() !== receptionistId) {
      this.throwBlocked('TASK_NOT_OWNED', 'Only the receptionist who accepted this task can release it');
    }

    const now = Date.now();
    const updated = await this.taskModel.findOneAndUpdate(
      {
        _id: taskId,
        status: AssignmentTaskStatus.ASSIGNED,
        acceptedByReceptionistId: this.toReceptionistId(receptionistId),
      },
      {
        $set: { status: AssignmentTaskStatus.PENDING },
        $unset: { acceptedByReceptionistId: '', acceptedAt: '' },
        $push: {
          history: this.historyEntry(
            now,
            AssignmentTaskStatus.ASSIGNED,
            AssignmentTaskStatus.PENDING,
            receptionistId,
            reason ? `released: ${reason}` : 'released',
          ),
        },
      },
      { new: true },
    );

    if (!updated) {
      // Lost a race with another transition (e.g. concurrent release/complete).
      this.throwBlocked('TASK_NOT_ASSIGNED', 'Assignment task is no longer assigned');
    }

    this.logger.log(`[Assignment] task=${taskId} released by receptionist=${receptionistId}`);

    return {
      code: ResponseCode.SUCCESS,
      message: 'Assignment task released',
      data: {
        taskId: updated!._id.toString(),
        status: updated!.status,
      },
    };
  }

  // ---- helpers --------------------------------------------------------------

  private async findByIdOrThrow(taskId: string): Promise<AppointmentAssignmentTaskDocument> {
    this.assertValidId(taskId);
    const task = await this.taskModel.findById(taskId).lean();
    if (!task) {
      this.throwBlocked('TASK_NOT_FOUND', 'Assignment task not found', true);
    }
    return task as AppointmentAssignmentTaskDocument;
  }

  private assertValidId(taskId: string): void {
    if (!Types.ObjectId.isValid(taskId)) {
      this.throwBlocked('TASK_NOT_FOUND', 'Assignment task not found', true);
    }
  }

  private toReceptionistId(receptionistId: string): Types.ObjectId {
    // Receptionists are accounts; accountId is a valid ObjectId.
    return new Types.ObjectId(receptionistId);
  }

  private historyEntry(
    at: number,
    from: AssignmentTaskStatus,
    to: AssignmentTaskStatus,
    by?: string,
    note?: string,
  ): AssignmentTaskHistoryEntry {
    return { at, from, to, by, note };
  }

  // Mirrors throwBlocked in the reschedule/cancel services for a consistent envelope.
  private throwBlocked(blockedReason: string, message: string, notFound = false): never {
    const payload = { code: ResponseCode.ERROR, message, data: { blockedReason } };
    if (notFound) {
      throw new NotFoundException(payload);
    }
    throw new BadRequestException(payload);
  }
}
