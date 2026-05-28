# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**ute-doctor-be** is a telemedicine platform backend built with NestJS 11. It manages appointment booking, medical visits, billing, real-time chat, and wallet/payment flows for patients, doctors, receptionists, and admins.

## Common Commands

```bash
# Development
npm run start:dev        # Hot-reload development server
npm run start:debug      # Debug mode with inspector

# Build & Production
npm run build            # Compile TypeScript to dist/
npm run start:prod       # Run compiled build

# Testing
npm run test             # Unit tests
npm run test:watch       # Watch mode
npm run test:e2e         # End-to-end tests
npm run test:cov         # Coverage report
npm run test -- --testPathPattern=appointment   # Run single test file/pattern

# Code Quality
npm run lint             # ESLint
npm run format           # Prettier

# Data
npm run seed:receptionist  # Seed receptionist data
```

## Architecture

### Module Organization

31+ feature modules grouped by domain:

**Auth & Identity:** `auth`, `account`, `profile`, `common`

**Healthcare:** `doctor`, `patient`, `appointment`, `shift`, `timeslot`, `visit`, `prescription`, `medical-record`

**Financial:** `billing`, `payment`, `wallet`, `coin`, `credit`

**Communication:** `chat`, `socket`, `notification`, `mail`

**Business:** `news`, `post`, `review`, `medicine`, `chuyen-khoa`, `receptionist`, `orchestration`, `admin`, `cloudinary`

### Core Architectural Patterns

**Request flow:** Controller → Service → Mongoose Model (no separate repository layer)

**Event-driven flows:** `EventEmitter2` handles async business events. Example: appointment booked → billing listener fires → billing created. Event listeners live in `*.listener.ts` files.

**Saga orchestration:** `src/orchestration/` handles complex multi-step workflows (e.g., shift registration saga).

**Distributed locking:** Redis-based locks via `RedisService` protect concurrency-sensitive operations (time slot booking, payment processing). Lock keys use TTL.

**RabbitMQ queues:** Used for chat message processing and coin expiry reminders. Controlled by env vars `RABBITMQ_ENABLED`, `CHAT_WRITE_MODE` (dual|worker), `CHAT_REALTIME_MODE` (direct|redis).

**Real-time:** Socket.io for presence tracking, chat, and notifications. The `SocketModule` manages connection state.

### Authentication & Authorization

- JWT Bearer tokens (30m expiry) + refresh tokens (7d)
- Guards: `JwtAuthGuard` validates tokens; `RoleGuard` enforces role-based access
- Apply with `@UseGuards(JwtAuthGuard, RoleGuard)` + `@Roles(RoleEnum.PATIENT)` decorator
- Roles: `PATIENT`, `DOCTOR`, `ADMIN`, `RECEPTIONIST`

### Database

MongoDB with Mongoose. Schema files are `*.schema.ts`, always export both the schema class and a `*Document` type. No Prisma. No migrations — schema changes are applied directly.

### Key Business Flows

**Appointment lifecycle:** Booking (with deposit deducted from wallet) → Checked in (receptionist) → Visit started → Visit completed → Billing created (auto via event) → Payment processed

**Billing:** `CONSULTATION_FEE` env var sets base fee. Insurance coverage applied at `INSURANCE_COVERAGE_RATE` (default 70%). Billing state machine: `DRAFT` → `FINALIZED` → `PAID`.

**Wallet/Coins:** Patients earn coins on payments. Coins expire after `COIN_EXPIRY_DAYS` days. Expiry reminders scheduled via RabbitMQ with distributed locks.

**Chat dual-write:** When `CHAT_WRITE_MODE=dual`, messages are written both directly and via RabbitMQ worker. `CHAT_REALTIME_MODE=redis` uses Redis pub/sub instead of direct Socket.io emit.

### Global Configuration (main.ts)

- `ValidationPipe` with `whitelist: true`, `forbidNonWhitelisted: true`, `transform: true`
- CORS for `localhost:3000` and `ute-doctor-fe.vercel.app`
- Static file serving from `uploads/` at `/uploads`

## Environment Variables

Key variables required in `.env` or `.env.local`:

```
MONGO_DB_URI
JWT_SECRET / JWT_REFRESH_SECRET / JWT_EXPIRES_IN / JWT_REFRESH_EXPIRES_IN
MAIL_HOST / MAIL_PORT / MAIL_USER / MAIL_PASS / MAIL_FROM
VN_PAY_TMNCODE / VN_PAY_HASHSECRET / VN_PAY_RETURNURL
CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET
REDIS_HOST / REDIS_PORT / REDIS_DB / REDIS_PASSWORD
RABBITMQ_URL / RABBITMQ_ENABLED
CHAT_WRITE_MODE / CHAT_REALTIME_MODE
CONSULTATION_FEE / INSURANCE_COVERAGE_RATE
COIN_EXPIRY_DAYS / COIN_REWARD_RATE
```

## Documentation Files

- [AGENTS.md](AGENTS.md) — AI-oriented repository summary
- [SCHEMA_CATALOG.md](SCHEMA_CATALOG.md) — Full database schema reference
- [CURRENT_APPOINTMENT_VISIT_BILLING_FLOW.md](CURRENT_APPOINTMENT_VISIT_BILLING_FLOW.md) — Current booking-to-billing workflow
- [BILLING_REFACTORING_SUMMARY.md](BILLING_REFACTORING_SUMMARY.md) — Billing module details
- [api-contract/](api-contract/) — FE/BE API contract submodule
