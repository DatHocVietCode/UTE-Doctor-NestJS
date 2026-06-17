import { WarningCode, WarningScope, WarningSeverity } from '../enums/warning.enums';

export interface LifecycleWarning {
  code: WarningCode | string;
  message: string;
  severity: WarningSeverity;
  scope: WarningScope;
  relatedNodeId?: string;
}
