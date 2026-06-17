import { ActorConfidence, ActorSource, ActorType } from '../enums/actor.enums';

export interface ActorSummary {
  actorId?: string;
  actorName?: string;
  actorEmail?: string;
  actorRole?: string;
  actorType: ActorType;
  actorConfidence: ActorConfidence;
  actorSource: ActorSource;
  actorWarnings?: string[];
}
