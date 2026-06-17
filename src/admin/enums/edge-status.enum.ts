// Confidence of the parent/child (or cross-record) relationship.
export enum EdgeStatus {
  STRONG_LINK = 'STRONG_LINK', // direct FK (e.g. Visit.appointmentId)
  WEAK_LINK = 'WEAK_LINK', // indirect join (e.g. Billing -> Visit -> Appointment) or payload-embedded
  INFERRED = 'INFERRED', // derived from stamps, no stored relation (e.g. slot lifecycle)
  MISSING = 'MISSING', // relationship expected but could not be established
}
