import {
  CampaignValues,
  ExternalDid,
  Issue,
  campaignIssues,
  campaignWarnings,
  normalizeDid,
  toValidationErrors,
} from '@dialer/shared';
import { Db } from '../db/store';
import { unprocessable } from './http';

/**
 * The server-side gate. It calls the SAME functions the client calls, so the two
 * cannot drift — the client's copy is a convenience, this one is authoritative.
 *
 * What the server adds is account-wide knowledge the client does not have: which DIDs
 * and transfer codes other campaigns already claim.
 */

export function externalDids(db: Db, exceptCampaignId: string): Map<string, ExternalDid> {
  const out = new Map<string, ExternalDid>();
  const campaignName = (cid: string) => db.campaigns.find((c) => c.id === cid)?.name ?? 'another campaign';
  db.queues.forEach((q) => {
    if (q.campaignId === exceptCampaignId) return;
    q.dids.forEach((did) => {
      out.set(normalizeDid(did), {
        queueName: q.name || 'an unnamed queue',
        campaignName: campaignName(q.campaignId),
      });
    });
  });
  return out;
}

export function externalTransferCodes(db: Db, exceptCampaignId: string): Map<string, ExternalDid> {
  const out = new Map<string, ExternalDid>();
  const campaignName = (cid: string) => db.campaigns.find((c) => c.id === cid)?.name ?? 'another campaign';
  db.queues.forEach((q) => {
    if (q.campaignId === exceptCampaignId) return;
    const code = String(q.transferCode ?? '').trim();
    if (!code) return;
    out.set(code, {
      queueName: q.name || 'an unnamed queue',
      campaignName: campaignName(q.campaignId),
    });
  });
  return out;
}

export function validationContext(db: Db, campaignId: string, values: CampaignValues) {
  const listIds = (values.leadLists as string[]) ?? [];
  return {
    externalDids: externalDids(db, campaignId),
    externalCodes: externalTransferCodes(db, campaignId),
    leadLists: db.leadLists.filter((l) => listIds.includes(l.id)),
  };
}

export function validateCampaign(db: Db, campaignId: string, values: CampaignValues): Issue[] {
  return campaignIssues(values, validationContext(db, campaignId, values));
}

export function warnCampaign(db: Db, campaignId: string, values: CampaignValues): Issue[] {
  return campaignWarnings(values, validationContext(db, campaignId, values));
}

/** Throws a 422 carrying field-keyed errors when anything blocks publish. */
export function assertPublishable(db: Db, campaignId: string, values: CampaignValues): void {
  const issues = validateCampaign(db, campaignId, values);
  if (issues.length) throw unprocessable(toValidationErrors(issues));
}
