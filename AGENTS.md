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

Notes:
- Some folders and filenames are in kebab-case, including Vietnamese names (e.g., `chuyen-khoa`, `tiep-tan`).
- There is mixed usage of single and double quotes in the codebase; lint/format settings indicate the preferred style is single quotes.