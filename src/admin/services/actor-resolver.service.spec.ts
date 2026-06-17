import { ActorConfidence, ActorSource, ActorType } from '../enums/actor.enums';
import { WarningCode } from '../enums/warning.enums';
import { emptyLookups } from '../dto/lifecycle-bundle';
import {
  actorFromHistoryBy,
  actorFromRelation,
  actorFromStoredField,
  roleInferredActor,
  systemActor,
  unknownActor,
} from './actor-resolver.service';

describe('actor resolver confidence matrix', () => {
  it('treats a "system" history actor as SYSTEM', () => {
    const a = actorFromHistoryBy('system');
    expect(a.actorType).toBe(ActorType.SYSTEM);
    expect(a.actorConfidence).toBe(ActorConfidence.SYSTEM_INFERRED);
  });

  it('treats a missing history actor as SYSTEM', () => {
    expect(actorFromHistoryBy(undefined).actorType).toBe(ActorType.SYSTEM);
  });

  it('resolves a concrete history actor id as EXACT/STORED_FIELD and fills name from lookups', () => {
    const lookups = emptyLookups();
    lookups.receptionists.set('recep1', { name: 'Rita Reception', email: 'rita@h.com' });
    const a = actorFromHistoryBy('recep1', lookups);
    expect(a.actorType).toBe(ActorType.USER);
    expect(a.actorConfidence).toBe(ActorConfidence.EXACT);
    expect(a.actorSource).toBe(ActorSource.STORED_FIELD);
    expect(a.actorId).toBe('recep1');
    expect(a.actorName).toBe('Rita Reception');
    expect(a.actorWarnings).toBeUndefined();
  });

  it('marks an unresolved relation ref with REF_UNRESOLVED but stays EXACT on the id', () => {
    const a = actorFromRelation('docX', 'DOCTOR', emptyLookups(), emptyLookups().doctors);
    expect(a.actorType).toBe(ActorType.USER);
    expect(a.actorSource).toBe(ActorSource.DOMAIN_RELATION);
    expect(a.actorId).toBe('docX');
    expect(a.actorWarnings).toContain(WarningCode.REF_UNRESOLVED);
  });

  it('falls back to ROLE_INFERRED when only a role is known on a stored field', () => {
    const a = actorFromStoredField(undefined, 'RECEPTIONIST');
    expect(a.actorConfidence).toBe(ActorConfidence.ROLE_INFERRED);
    expect(a.actorRole).toBe('RECEPTIONIST');
  });

  it('roleInferredActor is a USER with ROLE_INFERRED confidence', () => {
    const a = roleInferredActor('RECEPTIONIST');
    expect(a.actorType).toBe(ActorType.USER);
    expect(a.actorConfidence).toBe(ActorConfidence.ROLE_INFERRED);
  });

  it('systemActor and unknownActor have the right confidence/source', () => {
    expect(systemActor().actorConfidence).toBe(ActorConfidence.SYSTEM_INFERRED);
    const u = unknownActor();
    expect(u.actorType).toBe(ActorType.UNKNOWN);
    expect(u.actorSource).toBe(ActorSource.FALLBACK);
    expect(u.actorWarnings).toContain(WarningCode.ACTOR_UNKNOWN);
  });
});
