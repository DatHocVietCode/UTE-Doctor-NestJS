import { RoleEnum } from 'src/common/enum/role.enum';

export interface AuthUser {
  accountId?: string;
  email?: string;
  role?: RoleEnum | string;
  patientId?: string | null;
  doctorId?: string | null;
  profileId?: string | null;
  sub?: string;
  iat?: number;
  exp?: number;
}
