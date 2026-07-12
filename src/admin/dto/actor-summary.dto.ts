import { ActorConfidence, ActorSource, ActorType } from '../enums/actor.enums';

export interface ActorSummary {
  actorId?: string;
  actorName?: string;
  // Req 5: patient email must not surface in the admin lifecycle. actorEmail is dropped
  // wholesale (no role-conditional logic) — it carries no audit value.
  actorRole?: string;
  actorType: ActorType;
  actorConfidence: ActorConfidence;
  actorSource: ActorSource;
  actorWarnings?: string[];
}
