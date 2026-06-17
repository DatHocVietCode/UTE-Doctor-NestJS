export interface AdminAppointmentSummary {
  appointmentId: string;
  patient: { email?: string; name?: string } | null;
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
