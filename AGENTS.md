# AGENTS.md

This document summarizes the repository for humans and agentic tooling.

## Project Structure

Top-level:
- `src/` NestJS application source
- `test/` Jest e2e tests and config
- `public/` Static assets served by the app
- `dist/` Build output (generated)
- `migration-*.js` Data migration scripts
- `README*.md`, `MIGRATION_GUIDE.md`, `SCHEMA_CATALOG.md`, `CLOUDINARY_SETUP.md` Project docs
- `api-contract/README_CHAT_ARCHITECTURE.md` Chat architecture migration overview for FE/BE integration
- `package.json`, `tsconfig*.json`, `eslint.config.mjs`, `.prettierrc` Tooling configs

Key files in `src/`:
- `src/main.ts` App bootstrap (CORS, pipes, static assets, global prefix)
- `src/app.module.ts` Root module wiring
- `src/app.controller.ts`, `src/app.service.ts` Base controller/service

Feature modules (folders in `src/`):
- `account`
- `admin`
- `appointment`
- `auth`
- `chat`
- `chuyen-khoa`
- `cloudinary`
- `common`
- `database`
- `doctor`
- `mail`
- `medicine`
- `news`
- `notification`
- `orchestration`
- `patient`
- `payment`
- `post`
- `prescription`
- `profile`
- `receptionist`
- `review`
- `shift`
- `socket`
- `tiep-tan`
- `timeslot`
- `user-context`
- `utils`
- `wallet`

Common module layout patterns (varies by feature):
- `*.module.ts`, `*.controller.ts`, `*.service.ts`
- `dto/` request/response DTOs
- `schemas/` Mongoose schemas
- `enums/` or `enum/` domain enums
- `listeners/` or `listenners/` event listeners

## How to Run

Prerequisites:
- Node.js + npm
- MongoDB connection string
- Environment variables (loaded from `.env` and optionally `.env.local`)

Install dependencies:
```bash
npm install
```

Development:
```bash
npm run start:dev
```

Build:
```bash
npm run build
```

Production:
```bash
npm run start:prod
```

Environment variables used in the repo (names only; values are sensitive):
- `MONGO_DB_URI`, `PORT`
- `JWT_SECRET`, `JWT_REFRESH_SECRET`, `JWT_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN`
- `MAIL_USER`, `MAIL_PASS`, `MAIL_HOST`, `MAIL_PORT`, `MAIL_FROM`
- `OTP_EXPIRES`
- `VN_PAY_TMNCODE`, `VN_PAY_HASHSECRET`, `VN_PAY_RETURNURL`
- `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`
- `REDIS_HOST`, `REDIS_PORT`, `REDIS_DB`, `REDIS_PASSWORD`
- `RABBITMQ_URL`, `RABBITMQ_ENABLED`
- `CHAT_WRITE_MODE`, `CHAT_REALTIME_MODE`, `CHAT_QUEUE_MAX_RETRY`

## How to Test

Unit tests:
```bash
npm run test
```

Watch mode:
```bash
npm run test:watch
```

Coverage:
```bash
npm run test:cov
```

E2E tests:
```bash
npm run test:e2e
```

## Architecture Overview

- Framework: NestJS (TypeScript) with a modular, feature-based structure.
- HTTP App bootstrap in `src/main.ts`: global prefix `api`; CORS; global `ValidationPipe` (whitelist, transform, forbid non-whitelisted); static assets from `public/`.
- Config: `@nestjs/config` with `.env` and `.env.local`.
- Database: MongoDB via `@nestjs/mongoose` with async config from `MONGO_DB_URI`.
- Auth: JWT via `@nestjs/jwt` (global module) and auth/account modules.
- Events: `@nestjs/event-emitter` for domain events.
- Real-time: WebSockets via `@nestjs/platform-socket.io` (`socket` module).
- Integrations: Cloudinary, mailer (nodemailer), payment (VNPay), PDF generation (puppeteer), etc.

## Socket Architecture

- Socket.IO middleware handles authentication only.
- Gateways handle connection lifecycle and namespace event routing only.
- Services own business logic, including Redis-backed presence tracking.
- Presence tracking uses `user:{userId}:devices` SET plus `online_users` for multi-device, multi-instance support.
- TTL is a fallback safety net; the device set remains the source of truth.
- Prefer reusable services and avoid duplicating JWT parsing or Redis commands in gateway handlers.
- Future socket features such as notifications or booking sync should build on the same middleware -> gateway -> service split.

Socket connection flow guidance (FE + BE):
- Old flow (deprecated as global rule): connect -> `JOIN_ROOM` -> `ROOM_JOINED` -> business events.
- New flow (current): connect with `handshake.auth.token` -> middleware auth gate -> gateway lifecycle/presence -> business events.
- `JOIN_ROOM` remains required only for email-room namespaces (`/appointment`, `/payment/vnpay`, `/patient-profile`, `/notification`).
- `/chat` should use chat-specific room events (`CHAT_JOIN_USER`, `CHAT_JOIN_CONVERSATION`) instead of relying on `JOIN_ROOM` as a handshake gate.
- FE clients should emit `heartbeat` every 25-30 seconds on long-lived connections to refresh Redis presence TTL.

## Coding Conventions (Inferred)

- Language: TypeScript throughout.
- Nest conventions: Files named with `.module.ts`, `.controller.ts`, `.service.ts` and co-located per feature module.
- DTOs & Validation: DTO classes in `dto/` use `class-validator` decorators; validated via global `ValidationPipe`.
- Schemas: Mongoose schemas organized under `schemas/` within modules.
- Enums: Domain enums under `enums/` or `enum/`.
- Imports: Mix of relative and absolute `src/...` imports.
- Testing: Unit tests use `*.spec.ts` (configured in Jest); e2e tests live in `test/*.e2e-spec.ts`.
- Formatting/Linting: Prettier prefers single quotes and trailing commas; ESLint uses `typescript-eslint` and `eslint-plugin-prettier`.

## Refactoring Goals

- Simplify architecture by removing unnecessary event-driven patterns
- Prefer direct service-to-service calls over event emitters unless truly asynchronous
- Standardize authentication using JWT
- Remove passing userId/email manually in request body or params
- Separate reward points (`coin`) from monetary value (`credit`) to avoid financial ambiguity

## Authentication Rules

- All protected endpoints must use JWT guard
- User identity must be extracted from request context (req.user)
- Do NOT pass userId/email manually between layers

## Execution Simulation Rules

- After implementing changes:
  - Simulate running `npm run start:dev`
  - Simulate API calls for modified endpoints
  - Predict possible runtime errors

## User Normalization Rules

- All user data must be normalized to AuthUser at entry points (HTTP, WebSocket)
- Do NOT pass raw JWT payload deeper into the system
- Always use a consistent user shape across layers

## Datetime Rules

- NEVER accept datetime values without timezone information.
- All incoming datetime values must be ISO 8601 with timezone (`Z` or `+/-HH:mm`).
- ALWAYS convert datetime to UTC before business logic.
- ALWAYS store datetime as epoch milliseconds in persistence models when possible.
- NEVER mix local time strings in business logic.
- For temporary backward compatibility only, legacy datetime without timezone may fallback to `Asia/Ho_Chi_Minh` and must log `[TimeWarning]`.
- Register Shift MUST use `startTime` and `endTime` (ISO with timezone); NEVER use `YYYY-MM-DD` date-only payload for scheduling APIs.

## Time Handling Strategy

- All appointment schedule times are stored as epoch milliseconds in UTC.
- `scheduledAt` is the single source of truth for an appointment's scheduled time.
- `startTime` and `endTime` are snapshot fields persisted at booking/reschedule time.
- `shift` and `timeSlot` remain reference data only and must not be used to compute appointment time after booking.
- Frontend is responsible for timezone rendering; APIs return UTC epoch values.
- During migration, legacy records may fall back to `date`, but new writes must populate `scheduledAt`.

## Commenting Rule

- From now on, every code change must include concise comments for new or modified logic blocks when the behavior is not immediately obvious.
- Prefer comments that explain intent, fallback behavior, or invariants rather than restating the code.

## Payment TTL Rules

- Redis slot-lock TTL and pending booking expiration MUST match VNPay expiry window.
- Source of truth is `VN_PAY_EXPIRE_MINUTES` (default 15).
- Do NOT hardcode independent TTL values for booking lock/pending cleanup.

## Wallet Domain Separation Rules

- `Credit` is financial value (money-equivalent) and must be used for payment/refund accounting.
- `Coin` is reward value and must only be used as discount, never as full payment.
- Coin discount policy is percentage-based with per-transaction cap.
- Coin ledger must support expiration (`expiresAt`) and expired coin must be excluded from available balance.
- Coin cannot be converted to credit and cannot be withdrawn.
- Booking APIs must return amount breakdown (`originalAmount`, `discountAmount`, `finalAmount`) for FE display consistency.
- Refund flows (cancel/shift-cancel) should credit `CreditWallet`, not `CoinWallet`.

## Chat Messaging Migration Rules

- Chat message pipeline is migrating incrementally to queue-based processing; keep backward compatibility at every phase.
- Queue name for message-created events is `chat.message.created`.
- Default mode is dual-write (`CHAT_WRITE_MODE=dual`):
  - Gateway writes message to MongoDB (safe path)
  - Gateway also publishes event to RabbitMQ for validation/observability
- Worker mode (`CHAT_WRITE_MODE=worker`) is asynchronous:
  - Gateway publishes message event and ACKs early
  - Consumer persists message, updates conversation snapshot, and handles retries
- Realtime fanout mode:
  - `CHAT_REALTIME_MODE=direct`: gateway emits socket events directly (legacy-safe)
  - `CHAT_REALTIME_MODE=redis`: worker publishes to Redis channel and gateway fans out from pub/sub
- Keep `clientMessageId` idempotency protection enabled (unique sparse index + duplicate skip in worker).
- Typing/presence events are realtime-only and must not go through RabbitMQ.

## API Contract Submodule Rules

- `api-contract/` is a separate submodule and the source of truth for FE integration contracts.
- After ANY edit in `api-contract/` (for example `api-contract/api.md`), you MUST commit and push that submodule immediately.
- Do NOT delay contract-submodule push until BE root changes are ready; FE integration depends on latest submodule state.
- When sharing updates with FE, always provide the pushed submodule branch and latest commit hash.

## Unified Notification Architecture Rules

- Notification realtime must use one socket event: `NOTIFICATION_RECEIVED`.
- Preferred notification namespace for FE bell/realtime center is `/notification`.
- Payload contract must be typed discriminated union (`NotificationPayload`) with:
  - `type`
  - `data` (domain DTO, no flattening)
  - `createdAt` (epoch ms UTC)
  - `recipientEmail`
  - `idempotencyKey`
- Notification processing flow must be asynchronous:
  - domain listener -> RabbitMQ queue `notification.jobs`
  - queue consumer -> notification handler registry
  - handler -> Mongo persistence + Redis publish
  - socket bridge -> emit `NOTIFICATION_RECEIVED`
- Avoid switch-case in notification processing and FE rendering; use handler registry pattern keyed by `type`.
- Keep backward compatibility for old domain-specific socket events temporarily, but treat them as deprecated.

Notes:
- Some folders and filenames are in kebab-case, including Vietnamese names (e.g., `chuyen-khoa`, `tiep-tan`).
- There is mixed usage of single and double quotes in the codebase; lint/format settings indicate the preferred style is single quotes.
