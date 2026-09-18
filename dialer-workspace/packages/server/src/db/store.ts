import fs from 'fs';
import path from 'path';
import {
  CampaignValues,
  DispositionSet,
  DndEntry,
  DndList,
  InboundQueue,
  LeadList,
  LeadRecord,
  SimpleLibItem,
  Survey,
  TransferDirectory,
} from '@dialer/shared';

/**
 * THE MIGRATION BOUNDARY (build prompt §9).
 *
 * Phase 1 ships on the existing object model: inbound queues are stored as STANDALONE
 * records carrying a campaignId, exactly as the legacy PHP schema holds them. The API
 * layer assembles them into campaign-owned children so the client — and the user —
 * experience the collapsed model from day one.
 *
 * Phase 2 folds queues into the campaign record. Because nothing above this file knows
 * queues are stored separately, that is a change to this file alone. No React component
 * knows, and no route handler knows: they all go through `campaignWithQueues`.
 */

/** A campaign as stored: its values WITHOUT the owned queues. */
export interface StoredCampaign {
  id: string;
  name: string;
  desc: string;
  status: 'running' | 'draft';
  /** Everything except `queues`, which lives in its own collection in phase 1. */
  values: Omit<CampaignValues, 'queues'> & { queues?: never };
  published: Omit<CampaignValues, 'queues'> & { queues?: never };
  createdAt: string;
  updatedAt: string;
}

/** A queue as stored: standalone, pointing back at its owner. */
export interface StoredQueue extends InboundQueue {
  campaignId: string;
  /** Mirrors the published snapshot so dirty tracking survives a reload. */
  publishedSnapshot?: InboundQueue;
}

export interface Db {
  campaigns: StoredCampaign[];
  queues: StoredQueue[];
  leadLists: LeadList[];
  leadRecords: Record<string, LeadRecord[]>;
  dispositionSets: DispositionSet[];
  surveys: Survey[];
  dndLists: DndList[];
  dndEntries: Record<string, DndEntry[]>;
  transferDirectories: TransferDirectory[];
  pauseCodeSets: SimpleLibItem[];
  skillLists: SimpleLibItem[];
  agentScripts: SimpleLibItem[];
}

export function emptyDb(): Db {
  return {
    campaigns: [],
    queues: [],
    leadLists: [],
    leadRecords: {},
    dispositionSets: [],
    surveys: [],
    dndLists: [],
    dndEntries: {},
    transferDirectories: [],
    pauseCodeSets: [],
    skillLists: [],
    agentScripts: [],
  };
}

export class Store {
  db: Db = emptyDb();
  private file: string | null;
  private writeTimer: NodeJS.Timeout | null = null;

  constructor(file: string | null) {
    this.file = file;
    if (file && fs.existsSync(file)) {
      try {
        this.db = { ...emptyDb(), ...JSON.parse(fs.readFileSync(file, 'utf8')) };
      } catch (e) {
        console.warn(`[store] could not read ${file}, starting empty:`, (e as Error).message);
      }
    }
  }

  /** Debounced so a burst of PATCHes does not rewrite the file once per keystroke. */
  save(): void {
    if (!this.file) return;
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = setTimeout(() => this.flush(), 120);
  }

  flush(): void {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.db, null, 2));
  }

  reset(db: Db): void {
    this.db = db;
    this.save();
  }

  /* --------------------------------------------------- the assembly boundary */

  queuesFor(campaignId: string): InboundQueue[] {
    return this.db.queues
      .filter((q) => q.campaignId === campaignId)
      .map(({ campaignId: _c, publishedSnapshot: _p, ...queue }) => queue);
  }

  /** A campaign as the API presents it: queues folded in as owned children. */
  campaignWithQueues(stored: StoredCampaign) {
    const queues = this.queuesFor(stored.id);
    const published = this.db.queues
      .filter((q) => q.campaignId === stored.id && q.publishedSnapshot)
      .map((q) => q.publishedSnapshot!);
    return {
      id: stored.id,
      name: stored.name,
      desc: stored.desc,
      status: stored.status,
      method: stored.values.dialMethod,
      agents: String(stored.values.agentGroup ?? ''),
      lists: (stored.values.leadLists as string[]) ?? [],
      queues: queues.length,
      values: { ...stored.values, queues } as CampaignValues,
      published: { ...stored.published, queues: published } as CampaignValues,
    };
  }

  /** Split an incoming campaign back apart for storage. Cascade-deletes removed queues. */
  writeCampaignValues(campaignId: string, values: CampaignValues): void {
    const { queues, ...rest } = values;
    const stored = this.db.campaigns.find((c) => c.id === campaignId);
    if (!stored) return;
    stored.values = rest as StoredCampaign['values'];
    stored.name = String(values.name ?? '');
    stored.desc = String(values.description ?? '') || '—';
    stored.updatedAt = new Date().toISOString();

    const incoming = new Map(queues.map((q) => [q.id, q]));
    // Queues dropped from the payload are deleted with their campaign's edit.
    this.db.queues = this.db.queues.filter(
      (q) => q.campaignId !== campaignId || incoming.has(q.id),
    );
    queues.forEach((q) => {
      const existing = this.db.queues.find((x) => x.id === q.id && x.campaignId === campaignId);
      if (existing) Object.assign(existing, q);
      else this.db.queues.push({ ...q, campaignId });
    });
    this.save();
  }

  /** Cascade delete: a campaign takes its owned queues with it. */
  deleteCampaign(campaignId: string): void {
    this.db.campaigns = this.db.campaigns.filter((c) => c.id !== campaignId);
    this.db.queues = this.db.queues.filter((q) => q.campaignId !== campaignId);
    this.save();
  }

  /** Snapshot the current values as published, for dirty tracking. */
  publish(campaignId: string): void {
    const stored = this.db.campaigns.find((c) => c.id === campaignId);
    if (!stored) return;
    stored.published = JSON.parse(JSON.stringify(stored.values));
    stored.status = 'running';
    stored.updatedAt = new Date().toISOString();
    this.db.queues
      .filter((q) => q.campaignId === campaignId)
      .forEach((q) => {
        const { campaignId: _c, publishedSnapshot: _p, ...clean } = q;
        q.publishedSnapshot = JSON.parse(JSON.stringify(clean));
      });
    this.save();
  }
}

let store: Store | null = null;

export function getStore(): Store {
  if (!store) throw new Error('store not initialised');
  return store;
}

export function setStore(s: Store): Store {
  store = s;
  return s;
}
