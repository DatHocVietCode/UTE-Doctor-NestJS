import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import mongoose, { HydratedDocument } from "mongoose";
import { PaymentMethodEnum } from "src/payment/enums/payment-method.enum";
import { AppointmentStatus } from "../enums/Appointment-status.enum";
import { AssignmentStatus } from "../enums/assignment-status.enum";
import { CancellationActor } from "../enums/cancellation-actor.enum";
import { CancellationReasonCode } from "../enums/cancellation-reason-code.enum";
import { DepositStatus } from "../enums/deposit-status.enum";
import { NoShowSource } from "../enums/no-show-source.enum";
import { ACTIVE_DOCTOR_SLOT_PARTIAL_FILTER } from "./appointment.index";
import { PaymentCategory } from "../enums/payment-category.enum";
import { ServiceType } from "../enums/service-type.enum";

export type AppointmentDocument = HydratedDocument<Appointment>;
@Schema({ timestamps: true })
export class Appointment {
    _id!: mongoose.Types.ObjectId;

    // Deprecated: Use scheduledAt instead. Retained only for backward compatibility.
    @Prop()
    date!: number;

    // Source of truth for the scheduled appointment time in UTC epoch milliseconds.
    // This is the appointment date (khi khám).
    @Prop({ required: true })
    scheduledAt!: number;

    // Booking creation time in UTC epoch milliseconds. This is when the appointment was booked (khi đặt).
    @Prop({ required: true })
    bookingDate!: number;

    // Snapshot of the slot start time at booking/reschedule time.
    @Prop()
    startTime?: number;

    // Snapshot of the slot end time at booking/reschedule time.
    @Prop()
    endTime?: number;

    @Prop({ enum: AppointmentStatus, default: AppointmentStatus.PENDING })
    appointmentStatus!: AppointmentStatus;

    @Prop({ enum: ServiceType })
    serviceType!: ServiceType;

    @Prop()
    consultationFee!: number;

    // Billing uses this appointment snapshot to decide whether BHYT coverage applies.
    @Prop({ type: String, enum: PaymentCategory, default: PaymentCategory.DICH_VU })
    paymentCategory!: PaymentCategory;

    // Required deposit amount. This is not payment proof until depositStatus is PAID.
    @Prop({ type: Number, default: 0 })
    depositAmount!: number;

    // Deposit lifecycle is the proof boundary for applying booking deposits to billing.
    @Prop({ type: String, enum: DepositStatus, default: DepositStatus.NOT_REQUIRED })
    depositStatus!: DepositStatus;

    @Prop({ type: Number, default: 0 })
    depositPaidAmount!: number;

    @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Payment' })
    depositPaymentId?: mongoose.Types.ObjectId;

    @Prop()
    depositPaidAt?: number;

    // Snapshot discount from coin usage at booking time.
    @Prop({ default: 0 })
    coinDiscountAmount!: number;

    @Prop()
    paymentAmount!: number;

    @Prop()
    paidAt!: Date;

    @Prop()
    paymentResponseCode!: string;

    @Prop()
    paymentTransactionStatus!: string;

    // Optional: a broad (unassigned-doctor) appointment has no slot until a receptionist assigns one.
    // Normal booking still requires a slot — enforced in AppointmentBookingService.validateBookingRequest.
    @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'TimeSlotLog' })
    timeSlot?: mongoose.Types.ObjectId;

    @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true })
    patientId!: mongoose.Types.ObjectId; // This is account Id, not patient Id (To be fixed later)

    @Prop()
    patientEmail!: string;

    @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Doctor' })
    doctorId!: mongoose.Types.ObjectId;

    @Prop()
    reasonForAppointment!: string;

    @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'ChuyenKhoa' })
    specialtyId!: string;

    @Prop({ type: String, enum: PaymentMethodEnum })
    paymentMethod!: PaymentMethodEnum;

    @Prop()
    hospitalName!: string;

    // Routing state for broad / unassigned-doctor appointments.
    // NONE for normal bookings; AWAITING_ASSIGNMENT once a broad appointment is created;
    // ASSIGNED after a receptionist sets the doctor/slot. Kept as an explicit field for indexability.
    @Prop({ type: String, enum: AssignmentStatus, default: AssignmentStatus.NONE })
    assignmentStatus!: AssignmentStatus;

    @Prop()
    cancelledAt?: number;

    @Prop({ type: String, enum: CancellationActor })
    cancellationActor?: CancellationActor;

    @Prop({ type: String, enum: CancellationReasonCode })
    cancellationReasonCode?: CancellationReasonCode;

    @Prop()
    cancellationReason?: string;

    // No-show markers. Durable so the admin lifecycle can reconstruct the NO_SHOW node
    // (the lifecycle is reconstructed from state, not an audit log) and distinguish a
    // SYSTEM reconciliation from a manual staff action.
    @Prop()
    noShowAt?: number;

    @Prop({ type: String, enum: CancellationActor })
    noShowActor?: CancellationActor;

    @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Account' })
    noShowMarkedByAccountId?: mongoose.Types.ObjectId;

    @Prop({ type: String, enum: NoShowSource })
    noShowSource?: NoShowSource;

    // When the patient no-show email was sent. Null after a transition whose email was
    // deferred (e.g. an out-of-hours startup run); a later in-business-hours reconciler
    // pass sends it exactly once. In-app notification is created at transition time.
    @Prop()
    noShowNotifiedAt?: number;
}

export const AppointmentSchema = SchemaFactory.createForClass(Appointment);
AppointmentSchema.index({ scheduledAt: 1 });
AppointmentSchema.index({ doctorId: 1, scheduledAt: 1 });
AppointmentSchema.index({ patientId: 1, scheduledAt: 1 });
// Active appointments must not double-book a concrete doctor/date/slot.
// The partial filter additionally requires doctorId AND timeSlot to exist so that
// many broad (unassigned-doctor) PENDING appointments — which have null doctor/slot —
// do not collide on a single null key.
// NOTE (migration): the previous version of this index omitted the doctorId/timeSlot
// existence checks. Because the key spec is unchanged, MongoDB will report an
// IndexOptionsConflict and keep the OLD index; the old index must be dropped so this
// definition can be rebuilt. See PHASE7_8 notes / batch summary.
AppointmentSchema.index(
    { doctorId: 1, date: 1, timeSlot: 1 },
    {
        unique: true,
        partialFilterExpression: ACTIVE_DOCTOR_SLOT_PARTIAL_FILTER,
    },
);
