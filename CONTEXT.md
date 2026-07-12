# UTE Doctor — Domain Language

Glossary for the telemedicine platform backend. Defines the project-specific terms so the same word means the same thing across code, contract, and conversation.

## Patient Health & Vital Signs

**Vital Sign (Patient Vital Sign)**:
A single clinical measurement snapshot of a patient taken at or after receptionist check-in — a multi-metric record (height, weight, blood pressure, heart rate, optional blood type) captured at one point in time. Append-only and clinically owned; never patient self-entered.
_Avoid_: reading (when meaning the whole snapshot), measurement (when meaning the whole snapshot)

**Metric**:
One measured quantity inside a Vital Sign — e.g. heart rate, weight, the blood-pressure pair. A Vital Sign holds several metrics; a metric is the unit that gets a clinical status.

**Legacy Vital Sign Record**:
The pre-existing, currently-unused per-metric structure embedded in `MedicalEncounter.vitalSigns[]` (`type: BP|HR|TEMP|SPO2`). Distinct from the new standalone Vital Sign and not used by the health dashboard. Slated for future cleanup, untouched for now.

**Medical Profile**:
Slow-changing, patient self-entered baseline (height/weight/blood type) maintained via `POST /patients/me/medical-profile`. NOT a clinical measurement and NOT a source for the health dashboard.
_Avoid_: health profile, medical record (which is a separate legacy embedded structure)

**Health Summary**:
A read-only, derived view of a patient's health for the dashboard: the latest active Vital Sign, recent active history, and an aggregated overall status. Computed on read; never stored.

**Record State**:
The lifecycle of a Vital Sign: `ACTIVE` (current truth), `SUPERSEDED` (replaced by a correction), or `VOIDED` (invalidated, value preserved). Only `ACTIVE` records feed the Health Summary.

**Metric Status**:
A backend-owned clinical classification of one metric: `NORMAL`, `LOW`, `HIGH`, or `UNKNOWN`. The frontend never computes thresholds.

**Overall Status**:
A summary-level roll-up across a patient's latest active metrics: `STABLE`, `NEEDS_ATTENTION`, or `UNEVALUATED`. Blood type never influences it.

**Correction**:
A new ACTIVE Vital Sign that replaces an earlier one (which becomes SUPERSEDED), carrying `supersedesRecordId` and a required reason. Original values are never destructively edited.

**Source**:
Where a Vital Sign originated. MVP only emits `RECEPTIONIST_CHECK_IN`; the contract reserves `VISIT_INTAKE`, `MIGRATED`, `UNKNOWN` for later.

## Appointment Lifecycle & No-Show

**No-Show**:
A terminal appointment outcome: the appointment was valid and `CONFIRMED` (doctor/slot assigned, Visit `CREATED`), its scheduled time passed by more than the grace period, and the patient never checked in. It is the patient's failure to attend — distinct from a cancellation (someone chose to call it off) and from a failure (booking/payment never completed). Represented by `AppointmentStatus.NO_SHOW` and `VisitStatus.NO_SHOW`.
_Avoid_: cancelled (a no-show is not cancelled), expired (that word belongs to Assignment Timeout).

**Assignment Timeout**:
A terminal outcome for a **broad/unassigned** appointment whose receptionist assignment task passed its deadline before a doctor/slot was ever assigned. The system could not staff it — system fault. Resolves to `CANCELLED` with `reasonCode = ASSIGNMENT_TIMEOUT` and refunds a paid deposit. Strictly distinct from No-Show: timeout happens *before* assignment/Visit, No-Show happens *after* a confirmed appointment is missed.

**Forfeiture**:
Keeping a paid DICH_VU deposit because the loss was the patient's fault. A No-Show forfeits (`DepositStatus.FORFEITED`, no credit-wallet refund); an Assignment Timeout refunds. The deposit's purpose is to penalise non-attendance, so No-Show is the canonical forfeiture case.

**Actionability (Overdue)**:
Whether a patient may still act (cancel/reschedule) on an appointment. An appointment whose scheduled end + grace period has passed is **non-actionable** even before any reconciliation flips it to No-Show. Actionability is derived on read; it is not a stored status.

**No-Show Reconciliation**:
The idempotent backend process that transitions overdue confirmed appointments to No-Show. Runs on application startup (catch-up after restart/deploy) and daily at 06:00 Asia/Ho_Chi_Minh. It is a settlement job, not a realtime sweep, and it owns the No-Show side effects (notification/email), gated to business hours.

## Admin Analytics & Audit

**Examination (Khám)**:
The canonical countable unit for admin analytics (most-examined specialty, most-examined doctor, frequent patients): one appointment that ran to completion, i.e. `Appointment.appointmentStatus === COMPLETED`. A booking that was cancelled, no-show, or failed is NOT an examination. Distinct from the `Visit` entity — a Visit is the check-in→completion lifecycle record, whereas an Examination is counted off the appointment's terminal COMPLETED state.
_Avoid_: visit (the Visit entity is a separate record), booking (a booking is not yet an examination)

**Examined Specialty**:
The specialty attributed to an Examination for analytics: the *treating doctor's* specialty (`Doctor.chuyenKhoaId` reached via `Appointment.doctorId`), i.e. the specialty that actually delivered the exam — NOT the booking's requested `Appointment.specialtyId`. The requested `specialtyId` is nullable and reflects intent; it serves only as a fallback when the treating doctor has no `chuyenKhoaId`.
_Avoid_: requested specialty, booking specialty (those mean `Appointment.specialtyId`, a different thing)

**Admin-Visible Patient Identity**:
The only patient information the admin panel may display: the patient's **name** and **active/inactive account status** (`Account.status`), plus opaque id handles needed for row actions. Every other patient field — contact info (phone, email, gender, dob, avatar) and all clinical/medical data — is deliberately outside the admin's view. The restriction is patient-scoped; staff identity is unaffected.
_Avoid_: patient profile, patient details (those imply the full record, which the admin must not see)
