// Where a NO_SHOW transition originated. Operational provenance; not a lifecycle node.
export enum NoShowSource {
  // Startup catch-up reconciler run (after deploy/restart). Patient email suppressed
  // unless within business hours; the daily run sends it idempotently otherwise.
  STARTUP = 'STARTUP',
  // Scheduled daily 06:00 Asia/Ho_Chi_Minh reconciliation.
  DAILY_06AM = 'DAILY_06AM',
  // Intentional receptionist/admin action via PATCH /appointment/:id/no-show.
  MANUAL = 'MANUAL',
}
