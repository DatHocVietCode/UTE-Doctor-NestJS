export interface AuthUser {
  accountId?: string;
  email?: string;
  role?: string;
  patientId?: string | null;
  doctorId?: string | null;
  profileId?: string | null;
  sub?: string;
  iat?: number;
  exp?: number;
}
