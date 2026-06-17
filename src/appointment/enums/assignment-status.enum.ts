export enum AssignmentStatus {
  NONE = 'NONE', // normal appointment: doctor/slot chosen at booking time
  AWAITING_ASSIGNMENT = 'AWAITING_ASSIGNMENT', // broad appointment: no doctor/slot yet, waiting for a receptionist
  ASSIGNED = 'ASSIGNED', // broad appointment that has been assigned a doctor/slot
}
