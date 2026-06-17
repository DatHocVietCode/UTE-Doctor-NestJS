// Actor modelling. Actor identity is rarely stored on domain records, so the model
// is explicit about how confident we are and where the actor came from.

export enum ActorType {
  USER = 'USER',
  SYSTEM = 'SYSTEM',
  UNKNOWN = 'UNKNOWN',
}

export enum ActorConfidence {
  EXACT = 'EXACT', // a concrete user id/name was resolved
  ROLE_INFERRED = 'ROLE_INFERRED', // only the acting role could be inferred (e.g. receptionist endpoint)
  SYSTEM_INFERRED = 'SYSTEM_INFERRED', // an async/callback/system process performed it
  UNKNOWN = 'UNKNOWN', // no actor information at all
}

export enum ActorSource {
  STORED_FIELD = 'STORED_FIELD', // a stored actor field (e.g. createdByAccountId)
  DOMAIN_RELATION = 'DOMAIN_RELATION', // resolved via a domain relation (e.g. visit.doctorId)
  EVENT_TYPE_INFERENCE = 'EVENT_TYPE_INFERENCE', // inferred from the kind of event
  FALLBACK = 'FALLBACK', // last-resort fallback
}

export enum TimestampConfidence {
  EXACT = 'EXACT', // a dedicated timestamp field exists
  INFERRED = 'INFERRED', // derived from a correlated stamp (e.g. updatedAt)
  MISSING = 'MISSING', // no timestamp available
}
