# Notification Structured Payload Contract Analysis

## Problem Summary

Notification handlers were building human-readable `title` and `message` strings at creation time. Appointment dates could be interpolated as raw epoch values, and missing optional fields could leak as broken display text such as `undefined`. This violated the backend datetime rule: APIs return epoch milliseconds and the frontend formats dates.

The fix keeps backend date/time values as epoch milliseconds, but moves event details into structured `data` and adds role-specific `titleKey` / `messageKey` fields for frontend rendering.

## Broken Generation Points

- `src/notification/handlers/appointment-success-notification.handler.ts`
  - Previously persisted appointment details through display text and legacy details.
  - Now calls `buildAppointmentSuccessNotification(...)` per recipient role.
- `src/notification/handlers/appointment-cancelled-notification.handler.ts`
  - Previously risked patient/doctor receiving the same or role-ambiguous cancellation content.
  - Now uses patient or doctor template keys and structured cancellation data.
- `src/notification/handlers/appointment-rescheduled-notification.handler.ts`
  - Previously formatted schedule details directly in the handler.
  - Now stores `oldScheduledAt`, `newScheduledAt`, `appointmentDate`, and `scheduledAt` as epoch milliseconds.
- `src/notification/handlers/appointment-doctor-assigned-notification.handler.ts`
  - Patient-facing assignment notification now has a patient-specific key and structured assignment data.
- `src/notification/handlers/payment-success-notification.handler.ts`
  - Payment success now notifies the patient with structured appointment/payment data only.
- `src/notification/handlers/assignment-task-created-notification.handler.ts`
- `src/notification/handlers/assignment-task-reminder-notification.handler.ts`
- `src/notification/handlers/assignment-task-expired-notification.handler.ts`
  - Receptionist workflow notifications now use receptionist-specific keys and `deadlineAt` epoch milliseconds.
- `src/notification/handlers/coin-expiry-notification.handler.ts`
  - Coin reminder now publishes the saved structured payload; expiry dates stay in `data`.
- `src/socket/listenners/notification-redis.listenner.ts`
  - Redis bridge now forwards the saved notification payload to `recipientEmail` only.

## New DTO Shape

```ts
type NotificationDto = {
  _id: string;
  type: NotificationType;
  recipientEmail: string;
  recipientRole: 'PATIENT' | 'DOCTOR' | 'RECEPTIONIST' | 'ADMIN';
  title?: string;
  message?: string;
  titleKey?: string;
  messageKey?: string;
  data: Record<string, unknown>;
  isRead: boolean;
  createdAt: number | null;
  idempotencyKey?: string;
};
```

`title` and `message` remain for backward compatibility. New notifications use safe generic Vietnamese fallback copy and do not embed date/location details that the frontend must format.

## Epoch Rule Confirmation

- `createdAt` is returned as epoch milliseconds.
- Appointment fields in `data` (`appointmentDate`, `scheduledAt`, `bookingDate`, `oldScheduledAt`, `newScheduledAt`) are epoch milliseconds.
- Assignment task `deadlineAt` remains epoch milliseconds.
- Coin expiry `expiresAt` and `runAt` remain epoch milliseconds.
- Backend does not return ISO strings or formatted local dates for these notification fields.

## Template Keys Added

- Patient appointment success: `notification.patient.appointmentSuccess.title/message`
- Doctor assigned appointment from booking: `notification.doctor.assignedAppointment.title/message`
- Patient cancellation: `notification.patient.appointmentCancelled.title/message`
- Doctor cancellation: `notification.doctor.appointmentCancelled.title/message`
- Patient reschedule: `notification.patient.appointmentRescheduled.title/message`
- Doctor reschedule: `notification.doctor.appointmentRescheduled.title/message`
- Patient doctor assignment: `notification.patient.doctorAssigned.title/message`
- Patient payment success: `notification.patient.paymentSuccess.title/message`
- Receptionist task created: `notification.receptionist.assignmentTaskCreated.title/message`
- Receptionist task reminder: `notification.receptionist.assignmentTaskReminder.title/message`
- Receptionist task expired: `notification.receptionist.assignmentTaskExpired.title/message`

## Recipient Role Mapping

| Event | Recipients | Role-specific content |
| --- | --- | --- |
| `APPOINTMENT_SUCCESS` | Patient, assigned Doctor when doctor email exists | Patient and Doctor use different keys/messages |
| `APPOINTMENT_CANCELLED` | Patient, Doctor when doctor email exists | Patient and Doctor use different keys/messages |
| `APPOINTMENT_RESCHEDULED` | Patient, Doctor when doctor email exists | Patient and Doctor use different keys/messages |
| `APPOINTMENT_DOCTOR_ASSIGNED` | Patient only | Patient-specific keys |
| `PAYMENT_SUCCESS` | Patient only | Patient-specific keys |
| `ASSIGNMENT_TASK_CREATED` | Receptionists only | Receptionist-specific keys |
| `ASSIGNMENT_TASK_REMINDER` | Receptionists only | Receptionist-specific keys |
| `ASSIGNMENT_TASK_EXPIRED` | Receptionists only | Receptionist-specific keys |
| `COIN_EXPIRY_REMINDER` | Patient only | Patient/wallet data in structured payload |

## Contract Files Changed

- `api-contract/README_NOTIFICATION_UNIFIED_SOCKET.md`
  - Documents `NotificationType`, `NotificationRecipientRole`, `NotificationDto`, `NotificationPayload`, `NotificationMap`, template keys, and epoch millisecond rule.
- `api-contract/api.md`
  - Adds current notification DTO shape and clarifies date fields remain epoch milliseconds.
- `api-contract/README_NOTIFICATION_OWNERSHIP_SCOPE_FE_INTEGRATION.md`
  - Marks the previous "no shape change" note as superseded by the structured payload contract.

## Root Cause

The backend treated notification messages as the final display surface and mixed machine values with prose. Handlers also had duplicated notification construction logic, which made patient/doctor/receptionist content easy to drift or accidentally reuse. Socket fanout published notification envelopes that were not guaranteed to match the saved DB row.

## Fix Summary

- Centralized template/data creation in `src/notification/notification-template.helper.ts`.
- Added explicit notification schema fields: `type`, `recipientRole`, `titleKey`, `messageKey`, and `data`.
- Added `toStoredNotificationPayload(...)` so REST and socket responses share the saved notification shape.
- Changed `storeIfNotExists(...)` to return the saved row or `null`, preventing duplicate retries from publishing.
- Updated handlers to publish the saved structured payload only after persistence succeeds.
- Updated `/notification` Redis listener to emit `NOTIFICATION_RECEIVED` to `payload.recipientEmail` only.

## Manual Test Steps

1. Book an appointment and inspect Mongo notification rows.
   - Patient row has `recipientRole: PATIENT`, patient keys, and epoch fields in `data`.
   - Doctor row has `recipientRole: DOCTOR`, doctor keys, and no patient-perspective message.
2. Cancel an appointment.
   - Patient and doctor rows have role-specific keys and messages.
3. Reschedule an appointment.
   - `oldScheduledAt` and `newScheduledAt` are numbers in milliseconds.
4. Complete payment.
   - Patient receives `PAYMENT_SUCCESS` only; message contains no raw epoch.
5. Create/remind/expire a broad booking assignment task.
   - Receptionists receive assignment-task keys only.
6. Connect to `/notification` as each recipient.
   - `NOTIFICATION_RECEIVED` arrives only in the saved recipient email room.
