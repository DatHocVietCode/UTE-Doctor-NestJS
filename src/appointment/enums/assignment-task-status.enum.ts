export enum AssignmentTaskStatus {
  PENDING = 'PENDING', // created, awaiting a receptionist to accept
  ASSIGNED = 'ASSIGNED', // accepted/locked by one receptionist, doctor/slot not yet set
  COMPLETED = 'COMPLETED', // doctor + slot assigned, appointment now normal
  EXPIRED = 'EXPIRED', // deadline passed with no completion
  ESCALATED = 'ESCALATED', // deadline passed, escalated to admin/group
  CANCELLED = 'CANCELLED', // appointment cancelled / booking failed while task open
}
