// Ordered lifecycle phases for the admin appointment lifecycle tree.
// The numeric order in PHASE_ORDER is the canonical causal order used for stable sorting.
export enum LifecyclePhase {
  BOOKING = 'BOOKING',
  DEPOSIT = 'DEPOSIT',
  ASSIGNMENT = 'ASSIGNMENT',
  CONFIRMATION = 'CONFIRMATION',
  VISIT = 'VISIT',
  ENCOUNTER = 'ENCOUNTER',
  BILLING = 'BILLING',
  PAYMENT = 'PAYMENT',
  SLOT = 'SLOT',
  COMMUNICATION = 'COMMUNICATION',
  CANCELLATION = 'CANCELLATION',
  NO_SHOW = 'NO_SHOW',
  RESCHEDULE = 'RESCHEDULE',
  UNLINKED = 'UNLINKED',
}

// Canonical causal ordering. Lower = earlier in the lifecycle.
// SLOT / COMMUNICATION / CANCELLATION / RESCHEDULE / UNLINKED are placed after the
// main causal chain because they are enrichment / alternate / catch-all branches.
export const PHASE_ORDER: Record<LifecyclePhase, number> = {
  [LifecyclePhase.BOOKING]: 0,
  [LifecyclePhase.DEPOSIT]: 1,
  [LifecyclePhase.ASSIGNMENT]: 2,
  [LifecyclePhase.CONFIRMATION]: 3,
  [LifecyclePhase.VISIT]: 4,
  [LifecyclePhase.ENCOUNTER]: 5,
  [LifecyclePhase.BILLING]: 6,
  [LifecyclePhase.PAYMENT]: 7,
  [LifecyclePhase.SLOT]: 8,
  [LifecyclePhase.COMMUNICATION]: 9,
  [LifecyclePhase.CANCELLATION]: 10,
  [LifecyclePhase.NO_SHOW]: 11,
  [LifecyclePhase.RESCHEDULE]: 12,
  [LifecyclePhase.UNLINKED]: 13,
};
