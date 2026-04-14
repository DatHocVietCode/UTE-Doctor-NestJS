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

Notes:
- Some folders and filenames are in kebab-case, including Vietnamese names (e.g., `chuyen-khoa`, `tiep-tan`).
- There is mixed usage of single and double quotes in the codebase; lint/format settings indicate the preferred style is single quotes.
