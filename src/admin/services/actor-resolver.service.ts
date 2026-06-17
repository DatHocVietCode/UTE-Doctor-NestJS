import { Injectable } from '@nestjs/common';
import { ActorSummary } from '../dto/actor-summary.dto';
import { ActorLookups } from '../dto/lifecycle-bundle';
import { ActorConfidence, ActorSource, ActorType } from '../enums/actor.enums';
import { WarningCode } from '../enums/warning.enums';

// ── Pure actor-resolution helpers ────────────────────────────────────────────
// Actor identity is rarely stored on domain records. These helpers resolve the
// best-available actor and are explicit about confidence/source. None of them throw.

export function systemActor(): ActorSummary {
  return {
    actorType: ActorType.SYSTEM,
    actorConfidence: ActorConfidence.SYSTEM_INFERRED,
    actorSource: ActorSource.EVENT_TYPE_INFERENCE,
  };
}

export function unknownActor(extraWarnings: string[] = []): ActorSummary {
  return {
    actorType: ActorType.UNKNOWN,
    actorConfidence: ActorConfidence.UNKNOWN,
    actorSource: ActorSource.FALLBACK,
    actorWarnings: [WarningCode.ACTOR_UNKNOWN, ...extraWarnings],
  };
}

// Coarse role inferred from the kind of event (e.g. a receptionist-only endpoint).
export function roleInferredActor(role: string): ActorSummary {
  return {
    actorRole: role,
    actorType: ActorType.USER,
    actorConfidence: ActorConfidence.ROLE_INFERRED,
    actorSource: ActorSource.EVENT_TYPE_INFERENCE,
  };
}

function asId(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  return String(v);
}

// Resolve an account/person from a lookup map, defensively. Returns name/email if found.
function lookupNameEmail(
  id: string | undefined,
  ...maps: Array<Map<string, any> | undefined>
): { name?: string; email?: string; resolved: boolean } {
  if (!id) return { resolved: false };
  for (const map of maps) {
    const doc = map?.get(id);
    if (doc) {
      const name = doc.name ?? doc.fullName ?? doc.username ?? undefined;
      const email = doc.email ?? undefined;
      return { name, email, resolved: true };
    }
  }
  return { resolved: false };
}

// Actor from an assignment-task history entry's `by` field.
// 'system' (or empty) -> SYSTEM; otherwise a concrete user id (EXACT, STORED_FIELD).
export function actorFromHistoryBy(by: unknown, lookups?: ActorLookups): ActorSummary {
  const id = asId(by);
  if (!id || id.toLowerCase() === 'system') {
    return systemActor();
  }
  const { name, email, resolved } = lookupNameEmail(
    id,
    lookups?.receptionists,
    lookups?.accounts,
  );
  return {
    actorId: id,
    actorName: name,
    actorEmail: email,
    actorRole: 'RECEPTIONIST',
    actorType: ActorType.USER,
    actorConfidence: ActorConfidence.EXACT,
    actorSource: ActorSource.STORED_FIELD,
    actorWarnings: resolved ? undefined : [WarningCode.REF_UNRESOLVED],
  };
}

// Actor resolved through a domain relation (e.g. visit.doctorId). EXACT if the id is
// known; name/email filled when the relation resolves, REF_UNRESOLVED warning otherwise.
export function actorFromRelation(
  id: unknown,
  role: string,
  lookups?: ActorLookups,
  ...maps: Array<Map<string, any> | undefined>
): ActorSummary {
  const sid = asId(id);
  if (!sid) return unknownActor();
  const { name, email, resolved } = lookupNameEmail(sid, ...maps);
  return {
    actorId: sid,
    actorName: name,
    actorEmail: email,
    actorRole: role,
    actorType: ActorType.USER,
    actorConfidence: ActorConfidence.EXACT,
    actorSource: ActorSource.DOMAIN_RELATION,
    actorWarnings: resolved ? undefined : [WarningCode.REF_UNRESOLVED],
  };
}

// Actor from a stored actor field (createdByAccountId/createdByRole).
export function actorFromStoredField(
  accountId: unknown,
  role: string | undefined,
  lookups?: ActorLookups,
): ActorSummary {
  const sid = asId(accountId);
  if (!sid && !role) return unknownActor();
  if (!sid) return roleInferredActor(role as string);
  const { name, email, resolved } = lookupNameEmail(sid, lookups?.accounts, lookups?.doctors);
  return {
    actorId: sid,
    actorName: name,
    actorEmail: email,
    actorRole: role,
    actorType: ActorType.USER,
    actorConfidence: ActorConfidence.EXACT,
    actorSource: ActorSource.STORED_FIELD,
    actorWarnings: resolved ? undefined : [WarningCode.REF_UNRESOLVED],
  };
}

@Injectable()
export class ActorResolverService {
  fromHistoryBy(by: unknown, lookups?: ActorLookups): ActorSummary {
    return actorFromHistoryBy(by, lookups);
  }
  fromRelation(id: unknown, role: string, lookups?: ActorLookups, ...maps: Array<Map<string, any> | undefined>): ActorSummary {
    return actorFromRelation(id, role, lookups, ...maps);
  }
  fromStoredField(accountId: unknown, role: string | undefined, lookups?: ActorLookups): ActorSummary {
    return actorFromStoredField(accountId, role, lookups);
  }
  system(): ActorSummary {
    return systemActor();
  }
  roleInferred(role: string): ActorSummary {
    return roleInferredActor(role);
  }
  unknown(): ActorSummary {
    return unknownActor();
  }
}
