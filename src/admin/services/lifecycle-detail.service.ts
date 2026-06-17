import { Injectable, NotFoundException } from '@nestjs/common';
import { DataResponse } from 'src/common/dto/data-respone';
import { ResponseCode } from 'src/common/enum/reponse-code.enum';
import { LifecycleBundle } from '../dto/lifecycle-bundle';
import { LifecycleNodeDetail } from '../dto/lifecycle-node-detail.dto';
import { WarningCode, WarningScope, WarningSeverity } from '../enums/warning.enums';
import { AppointmentLifecycleService } from './appointment-lifecycle.service';
import { normalizeTimestamp } from './lifecycle-time.util';

// Patient-sensitive keys that must not leave the backend in a node-detail snapshot.
const SENSITIVE_KEYS = new Set([
  'password',
  'phone',
  'phonenumber',
  'address',
  'identitycard',
  'cccd',
  'cmnd',
  'dob',
  'dateofbirth',
  'healthinsurance',
  'healthinsurancenumber',
  'insurancenumber',
]);

// Heavy/clinical arrays are summarized to a count instead of leaking full payloads.
const HEAVY_ARRAY_KEYS = new Set([
  'prescriptions',
  'medications',
  'vitalsigns',
  'history',
  'medicalhistory',
  'drugallergies',
  'foodallergies',
  'bloodpressure',
  'heartrate',
]);

// Defensive, shallow-ish sanitizer: drops sensitive keys, summarizes heavy arrays,
// keeps small scalars/objects. Never throws.
export function sanitizeSnapshot(record: any, depth = 0): Record<string, unknown> {
  if (!record || typeof record !== 'object') return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    const k = key.toLowerCase();
    if (k === '__v') continue;
    if (SENSITIVE_KEYS.has(k)) {
      out[key] = '[redacted]';
      continue;
    }
    if (Array.isArray(value)) {
      if (HEAVY_ARRAY_KEYS.has(k)) {
        out[key] = { count: value.length };
      } else {
        out[key] = { count: value.length };
      }
      continue;
    }
    if (value && typeof value === 'object') {
      // Keep ObjectId/Date as strings; shallow-summarize nested objects one level deep.
      if (value instanceof Date) out[key] = value.getTime();
      else if (depth < 1) out[key] = sanitizeSnapshot(value, depth + 1);
      else out[key] = '[object]';
      continue;
    }
    out[key] = value as unknown;
  }
  return out;
}

function findSourceRecord(bundle: LifecycleBundle, collection: string, recordId: string | null): any {
  if (!recordId) return null;
  const byId = (arr: any[]) => (arr ?? []).find((d) => String(d?._id) === recordId) ?? null;
  switch (collection) {
    case 'appointments':
      return String(bundle.appointment?._id) === recordId ? bundle.appointment : null;
    case 'payments':
      return byId(bundle.depositPayments) ?? byId(bundle.billingPayments);
    case 'appointmentassignmenttasks':
      return byId(bundle.assignmentTasks);
    case 'visits':
      return String(bundle.visit?._id) === recordId ? bundle.visit : null;
    case 'medicalencounters':
      return String(bundle.encounter?._id) === recordId ? bundle.encounter : null;
    case 'billings':
      return String(bundle.billing?._id) === recordId ? bundle.billing : null;
    case 'timeslotslog':
      return String(bundle.timeSlot?._id) === recordId ? bundle.timeSlot : null;
    case 'credittransactions':
      return byId(bundle.creditTransactions);
    case 'cointransactions':
      return byId(bundle.coinTransactions);
    case 'notifications':
      return byId(bundle.notifications);
    default:
      return null;
  }
}

@Injectable()
export class LifecycleDetailService {
  constructor(private readonly lifecycleService: AppointmentLifecycleService) {}

  async getNodeDetail(id: string, nodeId: string): Promise<DataResponse<LifecycleNodeDetail>> {
    // Reuses the same defensive loader (invalid id / missing appointment -> 404).
    const { bundle, tree } = await this.lifecycleService.getBundleAndTree(id);

    const node = tree.nodes.find((n) => n.id === nodeId);
    if (!node) {
      throw new NotFoundException('Lifecycle node not found');
    }

    const warnings = [...node.warnings];
    const record = findSourceRecord(bundle, node.sourceCollection, node.sourceRecordId);
    let complete = true;
    let domainSnapshot: Record<string, unknown> = {};

    if (record) {
      domainSnapshot = sanitizeSnapshot(record);
    } else {
      // Synthetic / MISSING / TTL-expired source: return a safe partial, never a 500.
      complete = false;
      warnings.push({
        code: WarningCode.NODE_DETAIL_INCOMPLETE,
        message: 'Source record could not be resolved; returning partial detail.',
        severity: WarningSeverity.WARN,
        scope: WarningScope.NODE,
        relatedNodeId: nodeId,
      });
    }

    return {
      code: ResponseCode.SUCCESS,
      message: 'OK',
      data: {
        nodeId: node.id,
        eventType: String(node.eventType),
        phase: String(node.phase),
        timestamp: normalizeTimestamp(node.timestamp),
        statusBefore: node.statusBefore,
        statusAfter: node.statusAfter,
        actor: node.actor,
        domainSnapshot,
        sourceMeta: { collection: node.sourceCollection, recordId: node.sourceRecordId },
        warnings,
        complete,
      },
    };
  }
}
