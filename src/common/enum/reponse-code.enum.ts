export enum ResponseCode
{
    ACCOUNT_NOT_FOUND = "ACCOUNT_NOT_FOUND",
    SUCCESS = "SUCCESS",
    INVALID_TOKEN = "INVALID_TOKEN",
    SERVER_ERROR = "SERVER_ERROR",
    ERROR = "ERROR",
    PENDING = "PENDING",
    NOT_FOUND = "NOT_FOUND",
    // Patient health dashboard: stable code emitted when an authenticated account has no
    // patient profile. Distinct from "no measurements yet" (which is a 200 empty summary).
    PATIENT_NOT_FOUND = "PATIENT_NOT_FOUND",
    // Reserved for the FE mock-fallback layer only; the backend does not emit this for an
    // unmatched route (see api-contract/README_PATIENT_HEALTH_DASHBOARD.md).
    ROUTE_NOT_FOUND = "ROUTE_NOT_FOUND"
}