import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import mongoose, { HydratedDocument } from "mongoose";
import { AssignmentTaskStatus } from "../enums/assignment-task-status.enum";

export type AppointmentAssignmentTaskDocument = HydratedDocument<AppointmentAssignmentTask>;

// Audit entry for a single task state transition.
export interface AssignmentTaskHistoryEntry {
    at: number; // epoch ms when the transition happened
    from: string; // previous status
    to: string; // new status
    by?: string; // actor (receptionist/admin id or 'system')
    note?: string; // optional free-form context
}

@Schema({ timestamps: true })
export class AppointmentAssignmentTask {
    _id!: mongoose.Types.ObjectId;

    // The broad/unassigned appointment this task is routing.
    @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Appointment', required: true })
    appointmentId!: mongoose.Types.ObjectId;

    @Prop({ type: String, enum: AssignmentTaskStatus, default: AssignmentTaskStatus.PENDING })
    status!: AssignmentTaskStatus;

    // Optional pre-routing target (a receptionist the task was directed to).
    @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Receptionist' })
    assignedReceptionistId?: mongoose.Types.ObjectId;

    // Who actually accepted the task (single winner of the accept race).
    @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Receptionist' })
    acceptedByReceptionistId?: mongoose.Types.ObjectId;

    // SLA deadline in UTC epoch milliseconds.
    @Prop({ type: Number, required: true })
    deadlineAt!: number;

    @Prop({ type: Number })
    acceptedAt?: number;

    @Prop({ type: Number })
    completedAt?: number;

    @Prop({ type: Number })
    lastNotifiedAt?: number;

    @Prop({ type: Number, default: 0 })
    reminderCount!: number;

    // ChuyenKhoa id/name used for queue filtering / routing.
    @Prop({ type: String })
    specialty?: string;

    @Prop({ type: String, default: 'NORMAL' })
    priority?: string;

    @Prop({ type: String })
    reasonForAppointment?: string;

    @Prop({ type: String })
    patientEmail?: string;

    // Audit trail of state changes.
    @Prop({ type: [Object], default: [] })
    history!: AssignmentTaskHistoryEntry[];
}

export const AppointmentAssignmentTaskSchema = SchemaFactory.createForClass(AppointmentAssignmentTask);

// One ACTIVE task per appointment (only open states are constrained).
AppointmentAssignmentTaskSchema.index(
    { appointmentId: 1 },
    {
        unique: true,
        partialFilterExpression: {
            status: { $in: [AssignmentTaskStatus.PENDING, AssignmentTaskStatus.ASSIGNED] },
        },
    },
);

// Cron SLA scans (find due/near-deadline tasks without collection scans).
AppointmentAssignmentTaskSchema.index({ status: 1, deadlineAt: 1 });

// Receptionist queue listing / filtering by specialty.
AppointmentAssignmentTaskSchema.index({ status: 1, specialty: 1, createdAt: -1 });

// "My tasks" lookups for an acceptor.
AppointmentAssignmentTaskSchema.index({ acceptedByReceptionistId: 1, status: 1 });
