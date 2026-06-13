# Phân tích: Redis Online User & Broadcast Notification cho Receptionist (Edge Case Broad Booking)

> **Scope:** Chỉ phân tích / trace flow / chỉ ra bug-risk-improvement. **Không sửa source code.**
> **Branch:** `task/edge-case-not-select-doctor` · **Ngày:** 2026-06-06
> **Edge case:** Bệnh nhân đặt lịch **không chọn bác sĩ** (`broadBooking=true`) → hệ thống tạo `AppointmentAssignmentTask` (PENDING) và cần báo cho **receptionist** vào xử lý / assign doctor + slot.

---

## 0. TL;DR — Kết luận nhanh

| # | Phát hiện cốt lõi | Mức độ |
|---|---|---|
| 1 | **Broadcast cho receptionist KHÔNG dùng presence/online state.** Listener query **tất cả** account có `role=RECEPTIONIST` từ MongoDB rồi fan-out, bất kể online hay offline. | 🟡 Lệch khỏi kỳ vọng "broadcast cho *online* receptionist" — nhưng thực tế *an toàn hơn* (offline vẫn nhận được noti lưu DB). |
| 2 | **Toàn bộ presence (`online_users`, `isUserOnline`) hiện là code "chỉ ghi" / diagnostic.** `isUserOnline()` không được gọi ở đâu; `online_users` chỉ được đọc 1 lần để log. | 🟡 Dead-ish code, dễ gây hiểu nhầm; có latent bug nếu sau này có ai dựa vào nó. |
| 3 | **Phụ thuộc cứng vào RabbitMQ, không có fallback.** Nếu `RABBITMQ_ENABLED=false` hoặc RabbitMQ down → noti bị **drop âm thầm** (mất cả realtime push lẫn bản ghi DB). | 🔴 Risk thật. |
| 4 | **`appointment.assignment.reminder` và `appointment.assignment.expired` được emit nhưng KHÔNG có listener nào.** Reminder không re-notify; expiry không báo ai. | 🟠 Gap chức năng. |
| 5 | Presence có vài **latent bug**: `online_users` không TTL (rò rỉ khi process crash), heartbeat không re-create device key đã hết hạn, device-key TTL hết hạn khi socket vẫn sống. | 🟠 Chưa ảnh hưởng vì presence không được tiêu thụ, nhưng là bẫy. |
| 6 | Delivery realtime phụ thuộc FE **phải gọi `JOIN_ROOM`** (room = email). Nếu FE kết nối `/notification` nhưng quên join room → mất realtime (vẫn còn DB noti). | 🟠 Fragility. |

**Tổng kết:** Flow *hoạt động được* cho quy mô nhỏ và **đúng ở điểm quan trọng nhất** — nguồn sự thật cho receptionist là **queue list trong DB** (`GET /appointment/assignment-tasks?status=PENDING`), còn notification chỉ là "cú hích" realtime. Nhưng việc đặt tên/ý niệm "broadcast cho online receptionist" **không khớp** với hiện thực, và có vài risk vận hành (RabbitMQ, reminder/expiry, presence inconsistency) cần xử lý.

---

# PHẦN 1 — Redis Online User Management

## 1.1 Kiến trúc tổng quan

Toàn bộ presence nằm trong **`PresenceService`** ([src/socket/presence.service.ts](src/socket/presence.service.ts)), được gọi bởi vòng đời socket trong **`BaseGateway`** ([src/socket/base/base.gateway.ts](src/socket/base/base.gateway.ts)). Mọi namespace gateway (`/notification`, `/chat`, `/appointment`, `/auth`, `/patient-profile`, `/payment/vnpay`) đều `extends BaseGateway` nên dùng chung cơ chế.

```
Socket connect (mọi namespace)
   │  socket-auth.middleware: verify JWT → socket.data.userId = accountId|sub
   │                                        socket.data.authUser = { role, email, ... }
   ▼
BaseGateway.handleConnection ──► PresenceService.addConnection(userId, socketId)
   │                                 SADD  user:{userId}:devices  socketId
   │                                 EXPIRE user:{userId}:devices  60s
   │                                 SADD  online_users  userId
   │
   ├─ HEARTBEAT (client emit) ──► PresenceService.refreshTTL(userId, socketId, ns)
   │                                 EXPIRE user:{userId}:devices 60s  (+ log chẩn đoán)
   │
   ▼
BaseGateway.handleDisconnect ─► PresenceService.removeConnection(userId, socketId)
                                   SREM  user:{userId}:devices  socketId
                                   nếu SCARD == 0:  DEL user:{userId}:devices
                                                    SREM online_users userId
```

## 1.2 Trả lời trực tiếp từng câu hỏi

| Câu hỏi | Trả lời (theo code) |
|---|---|
| **Lưu ở đâu?** | Redis, qua `RedisService.getClient()` (ioredis). Logic trong `PresenceService`. |
| **Key pattern?** | `user:{userId}:devices` (Redis **SET** các socketId) + `online_users` (Redis **SET** các userId). `{userId}` = `accountId` hoặc `sub` từ JWT. |
| **Value structure?** | Cả hai đều là **SET** (không phải hash/json). Device set chứa socketId thô; `online_users` chứa userId thô. **Không lưu** role/email/namespace/timestamp. |
| **TTL / expiration?** | Chỉ `user:{userId}:devices` có TTL = `SOCKET_PRESENCE_TTL_SECONDS` (mặc định **60s**), refresh qua heartbeat. **`online_users` KHÔNG có TTL.** |
| **Khi nào mark online?** | `handleConnection` → `addConnection` ngay khi socket xác thực thành công (presence.service.ts:11-23). |
| **Khi nào remove/offline?** | `handleDisconnect` → `removeConnection`; chỉ xoá khỏi `online_users` khi `SCARD` device set về 0 (presence.service.ts:25-43). |
| **Heartbeat / refresh?** | Có. Event `HEARTBEAT` → `refreshTTL` chỉ chạy `EXPIRE` trên device key (presence.service.ts:45-71). Client phải chủ động emit heartbeat. |
| **Phân biệt role?** | **KHÔNG.** Presence chỉ biết userId. Role chỉ tồn tại trong `socket.data.authUser.role` (in-memory của từng socket), **không** được index vào Redis. |
| **Lưu connectionId/socketId?** | Có — socketId được lưu trong `user:{userId}:devices`. |
| **Multi-tab/device?** | Có hỗ trợ: mỗi socketId là 1 phần tử trong SET; user còn online khi còn ≥1 socketId. |
| **Disconnect bất thường?** | Dựa vào TTL 60s của device key (self-heal). Nhưng `online_users` **không** tự dọn (xem bug 1.4-A). |
| **Sync với DB / state khác?** | **Không.** Presence là Redis-only và (như Phần 2) không liên quan tới việc resolve receptionist từ MongoDB. |

**File tham chiếu chính:**
- [presence.service.ts:11-23](src/socket/presence.service.ts#L11-L23) — `addConnection`
- [presence.service.ts:25-43](src/socket/presence.service.ts#L25-L43) — `removeConnection`
- [presence.service.ts:45-71](src/socket/presence.service.ts#L45-L71) — `refreshTTL` (heartbeat)
- [presence.service.ts:73-80](src/socket/presence.service.ts#L73-L80) — `isUserOnline`
- [base.gateway.ts:33-61](src/socket/base/base.gateway.ts#L33-L61) — connect/disconnect lifecycle
- [socket-auth.middleware.ts:27-52](src/socket/middleware/socket-auth.middleware.ts#L27-L52) — gắn `userId` + `authUser`

## 1.3 Multi-instance (scale ngang)

- **Socket.IO KHÔNG cài Redis adapter.** `SocketAdapter` ([socket.adapter.ts:16-46](src/socket/socket.adapter.ts#L16-L46)) chỉ gắn auth middleware vào các namespace — không có `@socket.io/redis-adapter`. Hệ quả: `server.to(room).emit(...)` **chỉ tới được socket trên cùng 1 Node instance**.
- Việc fan-out cross-instance được giải quyết **riêng cho notification** bằng **Redis Pub/Sub bridge** (xem Phần 2.3), không phải bằng socket adapter.
- Presence SET nằm trên Redis dùng chung nên *về lý thuyết* nhìn được across-instance — nhưng vì presence không được tiêu thụ ở đâu (1.4), điều này hiện không có giá trị thực tế.

## 1.4 Bug / Inconsistency trong Presence

> Lưu ý: tất cả đều **latent** — hiện **chưa** gây lỗi nghiệp vụ vì presence **không được đọc** bởi logic nào (xem 1.5). Nhưng nếu tương lai có ai dựa vào presence (vd implement `getOnlineReceptionists()` như plan), các bug này sẽ kích hoạt.

**A. `online_users` rò rỉ / false positive (không TTL).**
`online_users` chỉ bị `SREM` trong `removeConnection` khi device set rỗng ([presence.service.ts:42](src/socket/presence.service.ts#L42)). Nhưng:
- Nếu Node process **crash**, `handleDisconnect` không chạy → device key tự hết hạn sau 60s, nhưng userId **vẫn nằm trong `online_users` vĩnh viễn**.
- Khi device key hết TTL lúc socket vẫn còn (miss heartbeat), Redis xoá device key nhưng **không** trigger `SREM online_users`.
→ `online_users` tích luỹ entry "ma", **không đáng tin** để liệt kê ai đang online.

**B. Heartbeat không "hồi sinh" device key đã hết hạn.**
`refreshTTL` chỉ gọi `EXPIRE` ([presence.service.ts:54](src/socket/presence.service.ts#L54)). Nếu device key đã bị xoá (miss vài nhịp heartbeat), `EXPIRE` trả `0`, code **chỉ log warning** chứ không `SADD` lại socketId / userId. → Socket vẫn sống nhưng `isUserOnline` trả `false` vĩnh viễn cho tới khi reconnect.

**C. TTL ngắn (60s) so với connection sống.**
Device key TTL mặc định 60s. Nếu FE không gửi heartbeat đủ dày (< 60s/lần), user "biến mất" khỏi presence dù socket TCP vẫn mở. Độ tin cậy của presence phụ thuộc hoàn toàn vào nhịp heartbeat của FE — đây là **dependency ngầm** không được enforce ở BE.

**D. `removeConnection` có race giữa `SREM` và `SCARD`.**
`SREM` rồi `SCARD` rồi `DEL`/`SREM online_users` là chuỗi lệnh không nguyên tử (presence.service.ts:33-42). Hai tab cùng disconnect gần nhau có thể xen kẽ. Tác động nhỏ (cùng lắm là online_users sai trạng thái nhất thời), nhưng đáng lưu ý nếu nâng cấp presence thành nguồn sự thật.

## 1.5 ⚠️ Phát hiện quan trọng nhất: Presence hiện KHÔNG được tiêu thụ

- `isUserOnline()` ([presence.service.ts:73](src/socket/presence.service.ts#L73)) **không được gọi ở bất kỳ đâu** trong toàn bộ `src/`.
- `online_users` chỉ được **đọc đúng 1 lần** và là để **log chẩn đoán** trong `refreshTTL` ([presence.service.ts:58](src/socket/presence.service.ts#L58)), không phục vụ quyết định nghiệp vụ nào.
- Tức là presence hiện chỉ là **side-effect ghi Redis + logging**. Không có router/notifier nào hỏi "ai đang online".

→ Đây là mấu chốt để đánh giá Phần 2: **broadcast cho receptionist không hề dựa trên presence.**

---

# PHẦN 2 — Broadcast Notification cho Receptionist (Edge Case)

## 2.1 Trace flow end-to-end

```
1. Patient POST /appointment/book  (broadBooking=true)
        │
        ▼  AppointmentBookingService.bookBroadAppointment()
        │   - tạo Appointment (PENDING, doctorId=null, assignmentStatus=AWAITING_ASSIGNMENT)
        │   - tạo AppointmentAssignmentTask (PENDING, deadlineAt)   [transaction]
        │   - (nếu DICH_VU) tạo deposit payment
        │   - emit EventEmitter2: 'appointment.assignment.created'
        │     (appointment-booking.service.ts:415-423)
        ▼
2. AssignmentNotificationListener.handleAssignmentCreated()
        │   (assignment.notify.listenner.ts:43-74)
        │   - accountModel.find({ role: RECEPTIONIST }).select('email')   ← QUERY DB, KHÔNG dùng presence
        │   - for mỗi receptionist:
        │        notificationPublisher.publish({ type:'ASSIGNMENT_TASK_CREATED',
        │           recipientEmail, idempotencyKey:`ASSIGNMENT_TASK_CREATED:{taskId}:{email}` })
        ▼
3. NotificationJobPublisher.publish()  →  RabbitMQ queue NOTIFICATION_JOBS_QUEUE
        │   (notification-job.publisher.ts:12-23)  ← nếu publish fail chỉ log warning
        ▼
4. NotificationQueueConsumer  →  NotificationService.process()  →  handler registry
        │   (notification.service.ts:88-102)
        ▼
5. AssignmentTaskCreatedNotificationHandler.handle()
        │   (assignment-task-created-notification.handler.ts:17-54)
        │   - storeIfNotExists(Notification{ receiverEmail:[email], idempotencyKey, ... })
        │        → nếu trùng idempotencyKey (dup key 11000) → return, KHÔNG emit lại
        │   - redisService.publish(NOTIFICATION_REDIS_CHANNEL, payload)
        ▼
6. NotificationRedisListener (mọi instance đều subscribe)
        │   (notification-redis.listenner.ts:17-33)
        │   - notificationGateway.emitToRoom(recipientEmail, 'NOTIFICATION_RECEIVED', payload)
        ▼
7. Receptionist socket (đã JOIN_ROOM bằng email) trên /notification nhận event realtime.
   Receptionist offline → bỏ lỡ realtime, nhưng Notification đã nằm trong DB
   → thấy khi load lại (GET notifications by email).
```

## 2.2 "Online receptionist" được xác định thế nào?

**Không xác định.** Listener lấy **toàn bộ** account `role=RECEPTIONIST` từ MongoDB ([assignment.notify.listenner.ts:45-48](src/notification/listenners/assignment.notify.listenner.ts#L45-L48)) và publish 1 job/receptionist. Comment trong code nói rõ chủ ý này:

> *"No new gateway and no role-aware presence: receptionists are resolved from Account by role."* (assignment.notify.listenner.ts:31-33)

Cơ chế "ai đang nghe được realtime" là **gián tiếp**: noti được emit vào **room = email** của receptionist. Ai đang có socket trong room đó (tức online + đã `JOIN_ROOM`) thì nhận realtime; ai không thì chỉ có bản ghi DB. **Presence Redis không tham gia.**

→ Plan gốc ([PHASE7_8_ASSIGNMENT_WORKFLOW_PLAN.md](PHASE7_8_ASSIGNMENT_WORKFLOW_PLAN.md) §2.3, BE-4) dự định thêm `online_role:RECEPTIONIST` + `getOnlineReceptionists()`, nhưng **chưa được implement** — bản hiện tại đi đường tắt MVP.

## 2.3 Xử lý multi-instance (đúng)

Mặc dù Socket.IO không có Redis adapter, notification vẫn tới được receptionist ở **bất kỳ instance nào** nhờ bridge:
- Handler `redisService.publish(NOTIFICATION_REDIS_CHANNEL, ...)` ([handler:47-53](src/notification/handlers/assignment-task-created-notification.handler.ts#L47-L53)).
- **Mọi** instance đều `subscribe` channel này và emit vào room local của mình ([notification-redis.listenner.ts:17-33](src/socket/listenners/notification-redis.listenner.ts#L17-L33)).

→ Đây là điểm thiết kế **tốt**: cross-instance realtime cho notification hoạt động mà không cần socket.io-redis-adapter.

## 2.4 Idempotency & xử lý receptionist offline (đúng)

- **Idempotency:** `idempotencyKey = ASSIGNMENT_TASK_CREATED:{taskId}:{email}` + unique sparse index trên `Notification.idempotencyKey` ([notification.schema.ts:32-33](src/notification/schemas/notification.schema.ts#L32-L33)). Event lặp → dup key 11000 → handler `return` trước khi publish socket → **không double-store, không double-emit** ([handler:43-45](src/notification/handlers/assignment-task-created-notification.handler.ts#L43-L45)).
- **Offline receptionist vẫn được phục vụ:** noti lưu với `receiverEmail:[email]`; `getNotificationsByEmail` filter `$or:[{isBroadcast:true},{receiverEmail:email}]` ([notification.service.ts:147-152](src/notification/notification.service.ts#L147-L152)) → receptionist offline thấy noti khi đăng nhập lại.
- **Multi-device:** emit vào room email → mọi tab/thiết bị của receptionist trong room đều nhận.

## 2.5 Nguồn sự thật thực sự = Queue List (đúng & quan trọng)

Receptionist không phụ thuộc 100% vào notification. Queue được đọc trực tiếp từ DB qua `GET /appointment/assignment-tasks?status=PENDING` ([appointment-assignment-task.controller.ts:30-43](src/appointment/appointment-assignment-task.controller.ts#L30-L43)). Kể cả khi notification thất bại hoàn toàn, task PENDING vẫn hiển thị trong queue. Đây là "lưới an toàn" thiết kế đúng — notification chỉ là nudge, không phải transport bắt buộc.

---

# PHẦN 3 — Bug / Risk / Gap (xếp theo mức độ)

| # | Mức | Vấn đề | Vị trí | Tác động | Đề xuất |
|---|-----|--------|--------|----------|---------|
| R1 | 🔴 **High** | **Không có fallback khi RabbitMQ down/disabled.** `publish()` chỉ log warning khi fail; vì DB-write nằm *trong consumer*, mất RabbitMQ = mất **cả** realtime **lẫn** bản ghi DB noti. | [notification-job.publisher.ts:12-23](src/notification/notification-job.publisher.ts#L12-L23), [rabbitmq.service.ts:21,91-103](src/common/rabbitmq/rabbitmq.service.ts#L91-L103) | Receptionist không được báo qua noti; chỉ còn cứu bởi việc họ tự poll queue list. | Khi publish trả `false` → fallback ghi `Notification` trực tiếp vào DB (+ publish Redis channel). Tách DB-write ra khỏi nhánh phụ thuộc RabbitMQ. |
| R2 | 🟠 **Med** | **`appointment.assignment.reminder` & `...expired` không có listener.** SLA scheduler emit nhưng không ai xử lý. | emit tại [sla.scheduler.ts:110](src/appointment/appointment-assignment-sla.scheduler.ts#L110), [:148](src/appointment/appointment-assignment-sla.scheduler.ts#L148); không có `@OnEvent` tương ứng | Task gần deadline không re-notify; task EXPIRED không báo admin/receptionist → có thể "chết âm thầm" (appointment PENDING không ai assign). | Thêm listener cho 2 event này (re-notify receptionist khi reminder; báo admin + đánh dấu review khi expired). |
| R3 | 🟠 **Med** | **Realtime phụ thuộc FE gọi `JOIN_ROOM`.** Receptionist kết nối `/notification` nhưng chưa join room email → không nhận realtime. | [base.gateway.ts:67-91](src/socket/base/base.gateway.ts#L67-L91), [notification-redis.listenner.ts:24-28](src/socket/listenners/notification-redis.listenner.ts#L24-L28) | Mất realtime nudge (vẫn còn DB noti). | (a) Auto-join room email ngay trong `handleConnection`; hoặc (b) thêm `role:RECEPTIONIST` room join lúc connect và emit 1 lần vào room đó. |
| R4 | 🟠 **Med** | **Presence inconsistency** (Phần 1.4 A/B/C/D): `online_users` rò rỉ, heartbeat không hồi sinh key, TTL ngắn. | [presence.service.ts:22,42,54](src/socket/presence.service.ts#L42) | Hiện vô hại (presence không được đọc), nhưng sẽ thành bug thật nếu implement `getOnlineReceptionists()`. | Trước khi dựa vào presence: dùng hash `presence:user:{id}` (role/email) + role set + dọn TTL đồng bộ; heartbeat phải re-`SADD` khi key đã mất. |
| R5 | 🟡 **Low** | **Dead/diagnostic code gây hiểu nhầm.** `isUserOnline()` không được gọi; `online_users` chỉ để log. | [presence.service.ts:73-80](src/socket/presence.service.ts#L73-L80) | Lập trình viên dễ tưởng broadcast "đã dùng presence". | Hoặc xoá, hoặc gắn TODO/doc nêu rõ "diagnostic only", hoặc dùng nó để làm role-aware presence. |
| R6 | 🟡 **Low** | **Fan-out O(N) theo số receptionist.** Mỗi task tạo N message queue + N DB write + N socket emit. | [assignment.notify.listenner.ts:55-73](src/notification/listenners/assignment.notify.listenner.ts#L55-L73) | OK với phòng khám nhỏ; tốn kém nếu N lớn. | Cân nhắc 1 `Notification` broadcast (`isBroadcast=true`) + emit 1 lần vào `role:RECEPTIONIST` room (O(1)). |
| R7 | 🟡 **Low** | **Listener lỗi bị nuốt.** `handleAssignmentCreated` chạy async qua EventEmitter2; nếu `accountModel.find` lỗi, booking đã trả success cho patient, lỗi không retry. | [assignment.notify.listenner.ts:43-74](src/notification/listenners/assignment.notify.listenner.ts#L43-L74) | Mất noti cho 1 task (queue list vẫn cứu). | Try/catch + log/metric; hoặc đẩy qua retry. |
| R8 | 🟡 **Low** | **Mất "khe" giữa commit và emit.** Nếu process chết sau khi commit task nhưng trước `emit('appointment.assignment.created')`, noti không bao giờ phát. | [appointment-booking.service.ts:369-423](src/appointment/appointment-booking.service.ts#L369-L423) | Task vẫn nằm queue (cứu bởi R-list); nhưng không có reminder (do R2) nên dễ trôi. | Outbox pattern, hoặc dựa vào reminder listener (sau khi fix R2) để bù. |

---

# PHẦN 4 — Khuyến nghị

### Ưu tiên ngắn hạn (đúng tinh thần MVP hiện tại)
1. **Fix R1 (RabbitMQ fallback)** — quan trọng nhất về độ tin cậy. Đảm bảo `Notification` luôn được ghi DB kể cả khi RabbitMQ không sẵn sàng; coi realtime push là best-effort phía trên.
2. **Fix R2 (reminder/expired listeners)** — đóng vòng SLA: reminder re-notify receptionist, expired báo admin để xử lý thủ công. Nếu không, edge case "không ai assign" sẽ kết thúc lặng lẽ ở trạng thái EXPIRED.
3. **Fix R3** — auto-join room (email và/hoặc `role:RECEPTIONIST`) ngay trong `handleConnection` để bớt phụ thuộc FE.

### Trung hạn (nếu muốn "broadcast cho *online* receptionist" đúng nghĩa)
4. Triển khai **role-aware presence** như plan BE-4: `online_role:RECEPTIONIST` set + `presence:user:{id}` hash (role/email), dọn dẹp đồng bộ ở disconnect/TTL, và **fix các bug 1.4 trước** khi để bất cứ logic nào đọc presence.
5. Chuyển fan-out sang **role room emit + 1 broadcast Notification** (giải quyết R6) — vừa O(1) realtime, vừa offline-safe qua DB.

### Lưu ý ý niệm
6. Thống nhất lại định nghĩa: hiện tại là **"notify tất cả receptionist (online qua socket + offline qua DB)"**, *không phải* "broadcast cho online receptionist". Bản chất này **tốt hơn** cho nghiệp vụ (không bỏ sót ai), nên có thể giữ — chỉ cần cập nhật mô tả/kỳ vọng cho khớp, và xử lý các risk vận hành ở Phần 3.

---

## Phụ lục — Bảng tra cứu key & event

**Redis keys**
| Key | Kiểu | TTL | Dùng cho |
|---|---|---|---|
| `user:{userId}:devices` | SET socketId | 60s (`SOCKET_PRESENCE_TTL_SECONDS`) | nguồn sự thật presence per-user |
| `online_users` | SET userId | none | index online (diagnostic, không tin cậy) |
| `slot:{doctorId}:{timeSlotId}` | string | `BOOKING_PENDING_TTL_SECONDS` | distributed lock booking/assign |
| `cron:assignment-sla...` (`SLA_LOCK_KEY`) | string | `SLA_LOCK_TTL_SECONDS` | lock 1 instance chạy SLA sweep |

**Redis pub/sub channels:** `NOTIFICATION_REDIS_CHANNEL` (notification bridge), `CHAT_MESSAGE_REDIS_CHANNEL` (chat realtime).

**EventEmitter2 (in-process) liên quan edge case**
| Event | Emit tại | Listener |
|---|---|---|
| `appointment.assignment.created` | bookBroadAppointment ([:415](src/appointment/appointment-booking.service.ts#L415)) | ✅ `AssignmentNotificationListener` ([:43](src/notification/listenners/assignment.notify.listenner.ts#L43)) |
| `appointment.assignment.completed` | assignDoctorAndSlot ([:401](src/appointment/appointment-assignment-task.service.ts#L401)) | ✅ `AssignmentNotificationListener` ([:76](src/notification/listenners/assignment.notify.listenner.ts#L76)) → notify **patient** |
| `appointment.assignment.reminder` | SLA scheduler ([:110](src/appointment/appointment-assignment-sla.scheduler.ts#L110)) | ❌ **không có** (R2) |
| `appointment.assignment.expired` | SLA scheduler ([:148](src/appointment/appointment-assignment-sla.scheduler.ts#L148)) | ❌ **không có** (R2) |

**Socket:** namespace `/notification`; event ra FE = `NOTIFICATION_RECEIVED`; room = email (lowercase). Auth qua `SocketAdapter` → `SocketAuthMiddleware`. **Không** có Socket.IO Redis adapter (cross-instance dựa vào `NOTIFICATION_REDIS_CHANNEL`).
