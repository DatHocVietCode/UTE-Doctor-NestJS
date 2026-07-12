export interface AdminAppointmentSummary {
  appointmentId: string;
  // Req 5: admin sees the patient NAME only — never email/contact PII.
  patient: { name?: string } | null;
  doctor: { id?: string; name?: string } | null;
  appointmentStatus?: string;
  assignmentStatus?: string;
  depositStatus?: string;
  paymentCategory?: string;
  visitStatus?: string | null;
  billingStatus?: string | null;
  bookingDate: number | null;
  scheduledAt: number | null;
  hasWarnings: boolean;
}

export interface AdminAppointmentListResult {
  items: AdminAppointmentSummary[];
  page: number;
  limit: number;
  total: number;
}
