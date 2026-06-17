# Notification Backend Creation Analysis

Date: 2026-06-15

## Scope

This investigation reviewed backend notification creation and delivery only:

- `src/notification/listenners/*.ts`
- `src/notification/handlers/*.ts`
- `src/notification/dto/notification-payload.dto.ts`
- `src/notification/schemas/notification.schema.ts`
- `src/notification/notification.service.ts`
- `src/socket/listenners/notification-redis.listenner.ts`
- appointment booking, cancellation, reschedule, payment success, assignment task, and shift cancellation event emitters.

## Current Creation Sites

| Source event | Listener | Handler | Recipients |
| --- | --- | --- | --- |
| `appointment.booking.success` -> `notify.patient.booking.success` | `AppointmentNotificationListener.handlePatientNotification` | `AppointmentSuccessNotificationHandler` | Patient |
| `appointment.booking.success` -> `notify.doctor.booking.success` | `AppointmentNotificationListener.handleDoctorNotification` | `AppointmentSuccessNotificationHandler` | Doctor, when `doctorEmail` exists |
| `notify.patient.appointment.cancelled` | `AppointmentNotificationListener.handlePatientAppointmentCancelled` | `AppointmentCancelledNotificationHandler` | Patient and Doctor, when `doctorEmail` exists |
| `appointment.rescheduled` -> `notify.patient.appointment.rescheduled` | `AppointmentNotificationListener.handlePatientRescheduledNotification` | `AppointmentRescheduledNotificationHandler` | Patient |
| `appointment.rescheduled` -> `notify.doctor.appointment.rescheduled` | `AppointmentNotificationListener.handleDoctorRescheduledNotification` | `AppointmentRescheduledNotificationHandler` | Doctor, when resolved |
| `payment.update` with `COMPLETED` | `PaymentNotificationListener.handlePaymentUpdate` | `PaymentSuccessNotificationHandler` | Patient only |
| `appointment.assignment.created` | `AssignmentNotificationListener.handleAssignmentCreated` | `AssignmentTaskCreatedNotificationHandler` | All receptionist accounts |
| `appointment.assignment.reminder` | `AssignmentNotificationListener.handleAssignmentReminder` | `AssignmentTaskReminderNotificationHandler` | All receptionist accounts |
| `appointment.assignment.expired` | `AssignmentNotificationListener.handleAssignmentExpired` | `AssignmentTaskExpiredNotificationHandler` | All receptionist accounts |
| `appointment.assignment.completed` | `AssignmentNotificationListener.handleAssignmentCompleted` | `AppointmentDoctorAssignedNotificationHandler` | Patient |
| `notify.patient.shift.cancelled` | `AppointmentNotificationListener.handlePatientShiftCancelled` | `AppointmentCancelledNotificationHandler` | Patient |
| `notify.doctor.shift.cancelled` | `AppointmentNotificationListener.handleDoctorShiftCancelled` | `AppointmentCancelledNotificationHandler` | Doctor |
| `notification.coin.expiry.reminder` | `CoinExpiryReminderNotificationListener` | `CoinExpiryNotificationHandler` | Patient |

## Root Cause

The backend created separate notification jobs for patient and doctor recipients, but those jobs only carried:

- `type`
- `data`
- `recipientEmail`
- `idempotencyKey`

They did not carry an explicit audience/recipient role. Handlers then selected templates by `type` only. For events that notify both patient and doctor (`APPOINTMENT_SUCCESS`, `APPOINTMENT_CANCELLED`, `APPOINTMENT_RESCHEDULED`), the same handler produced the same title/message for both recipients.

That means the DB rows could be addressed to different emails while still containing identical or patient-perspective copy. The bug is creation-time content selection, not frontend filtering.

No shared mutable DTO bug was found. The duplicate-content behavior came from one generic template per notification type.

## Socket Emit Check

Realtime notification delivery goes through:

`handler -> Redis publish -> NotificationRedisListener -> NotificationGateway.emitToRoom`

`NotificationRedisListener` emits `NOTIFICATION_RECEIVED` to `payload.recipientEmail`. This is recipient-room targeted, not a broad broadcast. The fix keeps that behavior and adds `recipientRole` to the realtime payload so socket logs and clients can inspect ownership.

## Fix Implemented

1. Added explicit audience metadata:
   - `NotificationRecipientRole = PATIENT | DOCTOR | RECEPTIONIST | ADMIN`
   - `NotificationPayload.recipientRole`
   - `NotificationHandlerMeta.recipientRole`
   - persisted `Notification.recipientEmail`
   - persisted `Notification.recipientRole`

2. Stamped audience at creation time:
   - patient booking/payment/cancel/reschedule/coin expiry: `PATIENT`
   - doctor booking/cancel/reschedule/shift cancel: `DOCTOR`
   - assignment task create/reminder/expired: `RECEPTIONIST`
   - appointment doctor assigned: `PATIENT`

3. Centralized role-specific templates in `src/notification/notification-template.helper.ts`.

4. Updated handlers to store ownership metadata at the DB top level and in `details`.

5. Updated Redis realtime payloads to include `recipientRole`.

6. Kept idempotency keys scoped by recipient email, so the same event may notify multiple users while duplicate retries for the same recipient/event are skipped.

## Recipient Mapping After Fix

| Event type | Patient content | Doctor content | Receptionist content |
| --- | --- | --- | --- |
| `APPOINTMENT_SUCCESS` | "Lich kham cua ban da duoc xac nhan..." | "Ban co lich kham moi voi benh nhan..." | N/A |
| `APPOINTMENT_CANCELLED` | "Lich kham cua ban ... da bi huy." | "Benh nhan ... da huy lich kham..." or shift-cancel copy | N/A |
| `APPOINTMENT_RESCHEDULED` | "Lich kham cua ban da duoc doi..." | "Lich kham voi benh nhan ... da duoc doi..." | N/A |
| `PAYMENT_SUCCESS` | "Thanh toan don ... cua ban..." | N/A | N/A |
| `APPOINTMENT_DOCTOR_ASSIGNED` | "Le tan da phan cong bac si..." | N/A | N/A |
| `ASSIGNMENT_TASK_CREATED` | N/A | N/A | "Yeu cau dat kham can phan cong bac si" |
| `ASSIGNMENT_TASK_REMINDER` | N/A | N/A | Reminder to process pending assignment |
| `ASSIGNMENT_TASK_EXPIRED` | N/A | N/A | Expired assignment task workflow copy |
| `COIN_EXPIRY_REMINDER` | Coin expiry reminder | N/A | N/A |

## Debug Fields Now Available

New notification records and realtime payloads include enough ownership fields to inspect creation correctness:

- `recipientEmail`
- `recipientRole`
- `type` in `details`
- appointment/task/payment identifiers in `details`
- patient/doctor emails where relevant
- `idempotencyKey`

## Duplicate Behavior

Allowed:

- One appointment event can create one patient row and one doctor row.
- Assignment task events can create one row per receptionist.

Not allowed:

- Retried queue jobs creating duplicate records for the same recipient/event.
- Doctor rows containing patient-perspective copy.
- Patient rows containing doctor-perspective copy.

Duplicate prevention remains based on unique sparse `idempotencyKey`.
