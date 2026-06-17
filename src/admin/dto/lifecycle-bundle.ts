// Plain (lean) data bundle handed to the pure reconstruction logic.
// Intentionally permissive (lean Mongoose docs) so reconstruction never assumes shape.
// This type imports NO schema classes, keeping the reconstruction unit-testable without
// Mongoose / decorator metadata.

export interface ActorLookups {
  doctors: Map<string, any>;
  patients: Map<string, any>;
  accounts: Map<string, any>;
  receptionists: Map<string, any>;
}

export interface LifecycleBundle {
  // Guaranteed non-null by the service (missing appointment -> 404 before reconstruction).
  appointment: any;
  depositPayments: any[];
  billingPayments: any[];
  assignmentTasks: any[];
  visit: any | null;
  encounter: any | null;
  billing: any | null;
  timeSlot: any | null;
  creditTransactions: any[];
  coinTransactions: any[];
  notifications: any[];
  lookups: ActorLookups;
  // Names of branches whose load failed/rejected, surfaced as global warnings.
  failedBranches?: string[];
}

export function emptyLookups(): ActorLookups {
  return {
    doctors: new Map(),
    patients: new Map(),
    accounts: new Map(),
    receptionists: new Map(),
  };
}
