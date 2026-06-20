export enum AppointmentStatus {
    PENDING = "PENDING",
    CONFIRMED = "CONFIRMED",
    FAILED = "FAILED",
    CANCELLED = "CANCELLED",
    COMPLETED = "COMPLETED",
    RESCHEDULED = "RESCHEDULED",
    // Terminal: appointment was CONFIRMED/assigned but the scheduled time passed
    // (beyond grace) with no check-in. Distinct from CANCELLED (deliberate) and
    // FAILED (booking/payment never completed). See docs/no-show-lifecycle-reconciliation-plan.md.
    NO_SHOW = "NO_SHOW"
}