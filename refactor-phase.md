# 📘 README – Backend Implementation (Refactor Phases)

## 🎯 Overview

Tài liệu này mô tả các bước **backend implementation** theo từng phase trong quá trình refactor từ Booking system → Clinic workflow system.

---

# 🔹 PHASE 0.5 – Receptionist Foundation

## Mục tiêu

* Tạo role mới: RECEPTIONIST
* Cung cấp API cơ bản cho FE integrate

## Implementation

* Add enum: `RECEPTIONIST`
* Update auth + JWT payload
* Implement RoleGuard
* Tạo module:

  * `/receptionist/test`
  * `/receptionist/visits` (mock)
  * `/receptionist/billing/:visitId` (mock)
* Seed script:

  * `receptionist@test.com / 123456`

---

# 🔹 PHASE 1 – Booking Refactor

## Mục tiêu

* Thêm metadata cho flow mới

## Implementation

* Add fields:

  * `visitType`
  * `paymentCategory`
  * `depositAmount`
* Rule:

  * BHYT → deposit = 0
* Keep:

  * paymentMethod (deprecated)
* Bypass old payment validation nếu có `paymentCategory`

---

# 🔹 PHASE 2 – Visit Entity

## Mục tiêu

* Tách Visit khỏi Appointment

## Implementation

* Create `Visit` entity:

  * appointmentId
  * doctorId
  * patientId
  * status
* Service:

  * createVisit
  * completeVisit
* Trigger:

  * check-in → create visit

---

# 🔹 PHASE 3 – Complete Visit

## Mục tiêu

* Lưu dữ liệu khám bệnh

## Implementation

* API:

  * diagnosis
  * note
  * prescriptions[]
* Update:

  * visit.status = COMPLETED
* Add:

  * isDispensed
  * unitPrice

---

# 🔹 PHASE 4 – Billing

## Mục tiêu

* Tạo hóa đơn sau khi khám

## Implementation

* Billing entity:

  * consultationFee
  * medicationFee
  * totalAmount
  * finalPayable
* Auto create:

  * khi visit completed
* Status:

  * DRAFT → FINALIZED
* Lock khi FINALIZED

---

# 🔹 PHASE 5 – Payment

## Mục tiêu

* Thanh toán sau khám

## Implementation

* Payment entity:

  * billingId
  * method: QR | CASH
  * status: PENDING | SUCCESS
* Flow:

  * billing finalized → create payment
  * success → billing = PAID
* Prevent double payment

---

# 🔹 PHASE 6 – Integration

## Mục tiêu

* Kết nối toàn bộ flow

## Flow

```
Booking → Check-in → Visit → Complete → Billing → Payment → Done
```

---

# ⚠️ Notes

* Không remove field cũ sớm
* Không migrate DB destructive
* Luôn test từng phase
