# ✅ CHECKLIST – Definition of Done (Per Phase)

## 🎯 Global

* [ ] API không lỗi 500
* [ ] FE gọi API thành công
* [ ] Không crash
* [ ] Không mất data

---

# 🔹 Phase 0.5

* [ ] Login receptionist OK
* [ ] Route `/receptionist` hoạt động
* [ ] API `/test` OK
* [ ] Role guard đúng

---

# 🔹 Phase 1

* [ ] Booking nhận `paymentCategory`
* [ ] BHYT → deposit = 0
* [ ] Không lỗi OFFLINE payment
* [ ] Flow cũ vẫn chạy

---

# 🔹 Phase 2

* [ ] Tạo được Visit
* [ ] Check-in hoạt động
* [ ] Doctor thấy visit

---

# 🔹 Phase 3

* [ ] Complete visit OK
* [ ] Lưu diagnosis
* [ ] Không submit duplicate

---

# 🔹 Phase 4

* [ ] Billing auto create
* [ ] Tính tiền đúng
* [ ] Finalize lock được

---

# 🔹 Phase 5

* [ ] Payment tạo được
* [ ] Mark paid OK
* [ ] Không double payment

---

# 🔹 Phase 6

* [ ] Full flow chạy end-to-end
* [ ] Không cần fix manual
* [ ] Data xuyên suốt

---

# 🚨 Fail Conditions

* Crash
* Sai tiền
* Duplicate logic
* Flow bị gãy

---

# 🎯 Rule

👉 Pass checklist = commit
👉 Bug ngoài scope → xử lý phase sau
