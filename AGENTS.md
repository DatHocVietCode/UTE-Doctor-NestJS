# AGENTS.md

Common repository guidance for humans and agentic tooling.

Keep this file lightweight. It should contain stable, cross-cutting rules only.

Feature-specific behavior, API contracts, business rules, migration notes, and ticket-specific decisions belong in `/docs` or `api-contract/`, not here.

## Project Overview

This repository is a NestJS backend application written in TypeScript.

Top-level structure:

- `src/` — application source code
- `test/` — Jest e2e tests and config
- `public/` — static assets
- `dist/` — generated build output
- `docs/` — feature notes, investigation reports, ticket plans, and business/domain documentation
- `api-contract/` — FE/BE API contract submodule
- `package.json`, `tsconfig*.json`, `eslint.config.mjs`, `.prettierrc` — tooling config

Common source layout:

- `*.module.ts`
- `*.controller.ts`
- `*.service.ts`
- `dto/`
- `schemas/`
- `enums/` or `enum/`
- `listeners/` or `listenners/`

## Common Commands

Install dependencies:

```bash
npm install
```

Run development server:

```bash
npm run start:dev
```

Build:

```bash
npm run build
```

Run tests:

```bash
npm run test
```

Run tests in watch mode:

```bash
npm run test:watch
```

Run coverage:

```bash
npm run test:cov
```

Run e2e tests:

```bash
npm run test:e2e
```

## Architecture Notes

- Framework: NestJS with modular feature-based structure.
- Database: MongoDB via Mongoose.
- Auth: JWT-based authentication.
- Events: `@nestjs/event-emitter` is used for domain events where asynchronous side effects are needed.
- Realtime: Socket.IO is used for realtime features.
- Config: environment variables are loaded through Nest config.

Treat source code as the source of truth for current behavior.

Treat `/docs` and `api-contract/` as required context when investigating feature behavior or FE/BE contract behavior.

## Scope Control

Before starting work, identify:

- What is in scope.
- What is out of scope.
- Whether the task is investigation only, planning only, implementation, or verification.

Do not implement code unless the user explicitly asks for implementation.

If the user asks for investigation or planning only, write reports/plans only.

## Search Before Concluding

For investigation tasks:

- Search source code before making claims.
- Search tests when behavior may already be covered.
- Search `/docs` and `api-contract/` when the task involves business behavior, FE/BE contracts, socket payloads, payment, notification, scheduling, or lifecycle state.
- Treat `/docs` as context, but treat current source code as the source of truth for current behavior.
- Do not say “not found”, “not implemented”, or “no references” unless relevant repository-wide searches were performed.

## Evidence-First Investigation

A useful investigation traces actual behavior, not just possible causes.

Always identify relevant:

- Entrypoints: controller, service, listener, consumer, scheduler, gateway, or job.
- State changes.
- Database writes.
- Events emitted.
- Async/background side effects.
- Notifications or realtime emissions.
- Payment/refund/wallet effects, when relevant.
- Query/read paths used by the user-facing screen.
- Existing tests and missing test coverage.

Prefer concrete file paths, class names, function names, and line numbers where available.

Do not present a root cause without code evidence.

## Compare Against Reference Flow

When a similar working flow exists, trace both flows.

Use a side-by-side comparison:

| Step | Reference Flow | Investigated Flow | Gap | Evidence |
|---|---|---|---|---|

The comparison should explain:

- What the working/reference flow does.
- What the investigated flow does.
- Which side effects or state transitions differ.
- Why that difference explains the user-visible symptom.

Do not stop at hypothesis ranking. Hypotheses are only useful if they lead to traced evidence.

## Ambiguity and Terminology Handling

Do not silently choose default interpretations for domain, contract, or product behavior.

When user terminology does not map cleanly to backend terminology:

1. List the candidate backend flows.
2. Trace each candidate enough to determine whether it matches the observed symptoms.
3. Use observed side effects to rank the best-matching flow.
4. Clearly separate:
   - confirmed code behavior,
   - recommended interpretation,
   - unresolved product/domain questions.

If one candidate flow uniquely explains the observed symptoms, state the root cause for that candidate clearly.

Do not let terminology ambiguity turn an evidence-backed technical root cause into vague speculation.

For planning-only tasks:

- You may recommend the safest implementation direction.
- Label product/domain assumptions explicitly.
- Provide an alternate plan if the assumption is rejected.

For implementation tasks:

- If ambiguity affects user-facing behavior, contract semantics, permissions, money, or lifecycle state, stop and ask before changing code.

## Root Cause Standard

A valid root cause must include:

- The exact code path where the problem happens.
- The missing or incorrect state transition, write, event, query condition, or side effect.
- Why other observed behavior can still work.
- Why the user-visible symptom follows from the code behavior.
- Evidence that rules out weaker hypotheses.

Example standard:

> Notification works because flow A emits event X.  
> Refund works because flow A emits event Y.  
> The screen remains stale because query Z reads stored field Q, and flow A never updates Q.

## Implementation Plan Quality

A useful implementation plan must be actionable.

Include:

- Recommended fix path.
- Why it is preferred.
- Minimal safe alternative.
- Files/classes/functions likely to change.
- Tests to add or update.
- Regression risks.
- Contract or FE-impact notes.
- Open questions that block implementation, if any.

Avoid producing only:

- hypothesis lists,
- rank-only conclusions,
- vague “check service logic” steps,
- purely conditional plans with no recommended path.

If the investigation found a concrete code gap, the plan must say how to close that gap.

## Shared Logic Preference

When fixing lifecycle/state-machine bugs, prefer reusing or extracting shared transition logic instead of duplicating partial behavior across flows.

Before adding new logic, check whether an existing canonical flow already performs the correct transition.

A good plan should explicitly decide between:

- reusing/extracting existing canonical logic,
- applying a minimal localized fix,
- adding a new domain path.

Explain the tradeoff.

## Coding Rules

- Follow existing NestJS module/controller/service patterns.
- Keep DTO validation with `class-validator`.
- Use existing schemas, enums, and shared utilities where possible.
- Prefer consistent user identity from authenticated request context instead of manually passing userId/email through request bodies.
- Do not introduce duplicate business logic if an existing service already owns the behavior.
- Keep comments concise and explain intent, fallback behavior, or invariants. Do not restate obvious code.

## Authentication Rules

- Protected endpoints must use JWT guard.
- User identity should come from `req.user` or the established auth context.
- Do not trust user identity passed manually from request body or params unless the endpoint explicitly requires admin-style lookup behavior.

## Time Handling Rules

- Prefer ISO 8601 datetime values with timezone for incoming API payloads.
- Convert datetime values to UTC before business logic.
- Store durable schedule timestamps as UTC-safe values, preferably epoch milliseconds where the domain already follows that pattern.
- Avoid mixing local date strings into business logic.
- When touching existing time-sensitive logic, inspect current docs and migration notes before changing behavior.

## API Contract Rules

- `api-contract/` is a separate submodule and is the source of truth for FE integration contracts.
- Do not duplicate full API contracts inside this file.
- When a change affects FE payloads, endpoint behavior, socket payloads, or response shape, update the contract in `api-contract/` as required by the task.
- If `api-contract/` is edited, commit and push the submodule separately when the workflow requires it.

## Documentation Rules

Use `/docs` for:

- Ticket investigation reports.
- Root-cause analysis.
- Implementation plans.
- Feature-specific business rules.
- Migration notes.
- Contract explanations that are too detailed for this file.

Suggested ticket structure:

```text
docs/ticket-<ticket-id>/
  INVESTIGATION.md
  PLAN.md
  TEST_PLAN.md
```

If no ticket ID exists, use a descriptive folder name.

## Investigation Report Template

Use this structure when writing investigation reports:

```md
# Investigation Report

## 1. Scope

## 2. Reproduction / Simulation

## 3. Symptom

## 4. Expected Behavior

## 5. Candidate Flows / Terminology Mapping

## 6. Current Investigated Flow

## 7. Reference Flow

## 8. Side-by-Side Comparison

| Step | Reference Flow | Investigated Flow | Gap | Evidence |
|---|---|---|---|---|

## 9. Root Cause

## 10. Confirmed Gaps

## 11. Ruled-Out Hypotheses

## 12. Recommended Implementation Plan

## 13. Minimal Safe Alternative

## 14. Test Plan

## 15. Risks / Open Questions
```

## Testing Rules

After implementation, run the most relevant tests when possible.

At minimum, identify:

- Unit tests to add or update.
- E2E or integration tests to add or update.
- Manual verification steps.
- Runtime risks that tests may not catch.

If tests cannot be run, state what was not run and why.

## Final Response Rules

When finishing a task, summarize:

- What was investigated or changed.
- Key evidence.
- Root cause or confirmed gap.
- Recommended implementation direction.
- Files changed, if any.
- Tests run or not run.
- Remaining uncertainty.

Do not include hidden scratch notes, leaked tool-call tags, or unfinished TODOs in final output.
