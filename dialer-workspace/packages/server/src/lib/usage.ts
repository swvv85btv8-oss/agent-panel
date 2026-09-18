import { DispositionNode } from '@dialer/shared';
import { Db } from '../db/store';

/**
 * USAGE COUNTS.
 *
 * Every library list view shows how many campaigns use each object. Computed in ONE pass
 * over the campaigns and handed back with the list payload, never as an N+1 per row.
 */
export interface UsageMap {
  leadLists: Record<string, number>;
  dispositionSets: Record<string, number>;
  surveys: Record<string, number>;
  dndLists: Record<string, number>;
  transferDirectories: Record<string, number>;
  pauseCodeSets: Record<string, number>;
  skillLists: Record<string, number>;
  agentScripts: Record<string, number>;
}

/** Which campaign field points at which library collection. */
const FIELD_TO_COLLECTION: Record<string, keyof UsageMap> = {
  dispositionList: 'dispositionSets',
  csatSurvey: 'surveys',
  dndList: 'dndLists',
  quickTransfer: 'transferDirectories',
  pauseCodeList: 'pauseCodeSets',
  skillList: 'skillLists',
  agentScript: 'agentScripts',
};

function dndIdsIn(tree: DispositionNode[], out: Set<string>): void {
  tree.forEach((n) => {
    if (n.action?.type === 'dnd' && n.action.dndList) out.add(n.action.dndList);
    dndIdsIn(n.children, out);
  });
}

export function computeUsage(db: Db): UsageMap {
  const usage: UsageMap = {
    leadLists: {},
    dispositionSets: {},
    surveys: {},
    dndLists: {},
    transferDirectories: {},
    pauseCodeSets: {},
    skillLists: {},
    agentScripts: {},
  };
  const bump = (col: keyof UsageMap, objId: string) => {
    if (!objId) return;
    usage[col][objId] = (usage[col][objId] ?? 0) + 1;
  };

  // A disposition set can add a lead to a DND list, so a campaign using that set also
  // depends on that DND list. Precomputed once rather than re-walked per campaign.
  const dndViaDispositionSet = new Map<string, Set<string>>();
  db.dispositionSets.forEach((set) => {
    const ids = new Set<string>();
    dndIdsIn(set.tree, ids);
    dndViaDispositionSet.set(set.id, ids);
  });

  db.campaigns.forEach((c) => {
    const v = c.values as Record<string, unknown>;
    Object.entries(FIELD_TO_COLLECTION).forEach(([field, col]) => {
      bump(col, String(v[field] ?? ''));
    });
    ((v.leadLists as string[]) ?? []).forEach((listId) => bump('leadLists', listId));

    const setId = String(v.dispositionList ?? '');
    const indirect = dndViaDispositionSet.get(setId);
    if (indirect) {
      indirect.forEach((dndId) => {
        // Do not double-count a DND list the campaign also names directly.
        if (dndId !== String(v.dndList ?? '')) bump('dndLists', dndId);
      });
    }
  });

  return usage;
}

export function withUsage<T extends { id: string }>(
  rows: T[],
  counts: Record<string, number>,
): Array<T & { usedByCampaigns: number }> {
  return rows.map((r) => ({ ...r, usedByCampaigns: counts[r.id] ?? 0 }));
}
