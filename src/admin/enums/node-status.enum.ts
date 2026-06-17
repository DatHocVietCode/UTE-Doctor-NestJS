// Defensive node status. The tree must remain useful even when data is incomplete.
export enum NodeStatus {
  OK = 'OK', // strong link + complete data
  PARTIAL = 'PARTIAL', // exists but some fields are derived/inferred or evidence is missing
  MISSING = 'MISSING', // an expected record is absent; placeholder shown
  LEGACY = 'LEGACY', // old-shape record / legacy status / pre-audit data
  CONFLICT = 'CONFLICT', // contradictory data detected
  UNKNOWN = 'UNKNOWN', // present but unparseable
}
