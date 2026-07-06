// One row in the admin receptionist list, joined from Receptionist -> Profile + Account.
// NEVER includes password/hash or other sensitive account internals. Date fields are epoch
// milliseconds UTC (api-contract convention). Fields are null/undefined-safe so legacy rows
// with a missing or dangling profile/account do not crash the endpoint.
export interface ReceptionistListItem {
  receptionistId: string;
  accountId: string | null;
  profileId: string | null;
  email: string;
  fullName: string;
  phone?: string;
  gender?: string;
  dateOfBirth?: number | null;
  address?: string;
  avatarUrl?: string;
  hospitalName?: string;
  accountStatus?: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface ReceptionistListResponse {
  receptionists: ReceptionistListItem[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}
