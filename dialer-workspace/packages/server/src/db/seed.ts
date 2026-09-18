import {
  CAMPAIGN_DEFAULTS,
  DispositionNode,
  LeadRecord,
  makeNode,
  newCustomColumn,
  newFixedColumns,
  newQueue,
  newVoiceSurvey,
  newWebSurvey,
  suggestCode,
  uniqueCode,
} from '@dialer/shared';
import { id } from '../lib/ids';
import { Db, StoredCampaign, StoredQueue, emptyDb } from './store';

/**
 * SEEDED DEFAULTS.
 *
 * Every library object ships with a working default on a new account, and each can also
 * be created inline from a campaign dropdown. Together those two facts mean a new account
 * can publish a working campaign without ever visiting the library — the central
 * usability goal of the whole restructure.
 */

const FNAMES = ['Rahul', 'Priya', 'Amit', 'Sneha', 'Vikram', 'Anita', 'Rohit', 'Kavya', 'Suresh', 'Deepa'];
const LNAMES = ['Sharma', 'Patel', 'Nair', 'Reddy', 'Iyer', 'Gupta', 'Singh', 'Mehta', 'Desai', 'Joshi'];
const CITIES = ['Mumbai', 'Pune', 'Nashik', 'Thane', 'Nagpur', 'Surat', 'Ahmedabad', 'Indore'];
const FIRMS = ['Sunrise Traders', 'Meridian Retail', 'Kalpataru Ltd', 'Anand Motors', 'Vertex Logistics'];

/** Deterministic so a reseed produces the same demo data. */
function hash(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h;
}

function node(name: string, code: string, children: DispositionNode[] = [], action: any = null) {
  const n = makeNode(id('n'), name, code, action);
  n.children = children;
  return n;
}

export function buildSeed(): Db {
  const db = emptyDb();

  /* ------------------------------------------------------------- lead data */
  const mkList = (name: string, desc: string, custom: Array<{ label: string; sensitive?: boolean }>) => {
    const list = {
      id: id('ll'),
      name,
      desc,
      records: 0,
      updated: '13 Aug',
      fixed: newFixedColumns(),
      custom: custom.map((c) => ({ ...newCustomColumn(id('c'), c.label), sensitive: !!c.sensitive })),
    };
    db.leadLists.push(list);
    return list;
  };

  const west = mkList('WEST_HFC_JUL', 'West region July dialing file', [
    { label: 'Loan Account No', sensitive: true },
    { label: 'Outstanding Amount', sensitive: true },
    { label: 'Bucket' },
    { label: 'Branch' },
  ]);
  const bounce = mkList('Bounce_W2', 'Second-cycle bounce recovery', [
    { label: 'Loan Account No', sensitive: true },
    { label: 'Outstanding Amount', sensitive: true },
    { label: 'Bucket' },
    { label: 'Branch' },
  ]);
  const renewal = mkList('Renewal_AUG', 'Policy renewal outreach', [
    { label: 'Policy Number', sensitive: true },
    { label: 'Renewal Date' },
    { label: 'Premium' },
  ]);

  const genRecords = (listId: string, n: number): LeadRecord[] => {
    const list = db.leadLists.find((l) => l.id === listId)!;
    const rows: LeadRecord[] = [];
    for (let i = 0; i < n; i++) {
      const h = hash(`${listId}:${i}`);
      const pick = <T,>(arr: T[], o = 0) => arr[(h >>> o) % arr.length];
      const first = pick(FNAMES);
      const last = pick(LNAMES, 3);
      const row: LeadRecord = {
        id: id('r'),
        phone: '+91' + (70 + (h % 29)) + String(1000000 + (h % 8999999)).slice(0, 7),
        name: `${first} ${last}`,
        email: `${first}.${last}`.toLowerCase() + '@' + pick(['gmail.com', 'outlook.com', 'yahoo.in'], 5),
        address: `${100 + (h % 899)}, ${pick(CITIES, 7)}`,
        company: pick(FIRMS, 9),
        altphone: '+91' + (70 + ((h >>> 4) % 29)) + String(1000000 + ((h >>> 4) % 8999999)).slice(0, 7),
      };
      list.custom.forEach((c, ci) => {
        const label = c.label.toLowerCase();
        const hh = hash(`${listId}:${i * 97 + ci}`);
        row[c.id] = label.includes('amount') || label.includes('premium') || label.includes('outstanding')
          ? '₹' + (5000 + (hh % 295000)).toLocaleString('en-IN')
          : label.includes('date')
            ? `${1 + (hh % 28)} ${['Jan', 'Mar', 'Jun', 'Aug', 'Oct', 'Dec'][hh % 6]} 2026`
            : label.includes('bucket')
              ? 'B' + (1 + (hh % 4))
              : label.includes('branch')
                ? CITIES[hh % CITIES.length]
                : label.includes('account') || label.includes('policy') || label.includes('number')
                  ? String(40000000 + (hh % 59999999))
                  : 'Value ' + (1 + (hh % 40));
      });
      rows.push(row);
    }
    list.records = n;
    return rows;
  };

  db.leadRecords[west.id] = genRecords(west.id, 240);
  db.leadRecords[bounce.id] = genRecords(bounce.id, 160);
  db.leadRecords[renewal.id] = genRecords(renewal.id, 120);

  /* ------------------------------------------------------------ compliance */
  const dnd = { id: id('dnd'), name: 'DND', desc: 'TRAI registry sync', def: true, count: 0 };
  const dndPlus = { id: id('dnd'), name: 'DND + internal', desc: 'Registry plus internal suppression', count: 0 };
  db.dndLists.push(dnd, dndPlus);
  const genDnd = (listId: string, n: number) => {
    const rows = [];
    for (let i = 0; i < n; i++) {
      const h = hash(`${listId}:${i}`);
      // Roughly one in seventeen is a prefix, which blocks a whole series at once.
      rows.push(
        h % 17 === 0
          ? { id: id('de'), value: '+91' + (70 + (h % 29)) + String(100 + (h % 900)).slice(0, 3), type: 'Prefix' as const }
          : { id: id('de'), value: '+91' + (70 + (h % 29)) + String(1000000 + (h % 8999999)).slice(0, 7), type: 'Number' as const },
      );
    }
    return rows;
  };
  db.dndEntries[dnd.id] = genDnd(dnd.id, 342);
  db.dndEntries[dndPlus.id] = genDnd(dndPlus.id, 118);
  dnd.count = 342;
  dndPlus.count = 118;

  /* ---------------------------------------------------------- call outcomes */
  db.dispositionSets.push(
    {
      id: id('ds'),
      name: 'Standard outcomes',
      def: true,
      tree: [
        node('Interested', 'Intr'),
        node('Not interested', 'Notint', [], { type: 'dnd', dndList: dnd.id }),
        node('Call back', 'Clbk', [], { type: 'callback', window: '24' }),
        node('Wrong number', 'Wrng'),
      ],
    },
    {
      id: id('ds'),
      name: 'SMFG',
      tree: [
        // Legacy 4-5 character codes, kept as-is: the 3-character rule binds new codes.
        node('Payment Done', 'Pytd', [
          node('Policy issued', 'Plcyi'),
          node('Presale Closed', 'Precl'),
          node('Rejected', 'Rgct'),
          node('Cancelled', 'Cncl'),
        ]),
        node('Connected', 'Contd', [
          node('Interested', 'Intr', [
            node('No money', 'Nomny', [
              node('Refuse to pay', 'Rfpay', [
                node('Do not call again', 'Dntcl', [], { type: 'dnd', dndList: dnd.id }),
              ]),
            ]),
          ]),
          node('Not interested', 'Notint', [], { type: 'dnd', dndList: dnd.id }),
          node('Call back later', 'Clbk', [], { type: 'callback', window: '24' }),
        ]),
        node('Not Connected', 'Notcn', [
          node('Ringing no answer', 'Rna'),
          node('Switched off', 'Swof'),
          node('Busy', 'Busy', [], { type: 'sms', template: 'We tried to reach you' }),
        ]),
      ],
    },
    {
      id: id('ds'),
      name: 'Collections v2',
      tree: [node('Paid', 'Paid'), node('Partial', 'Prtl'), node('Refused', 'Rfsd'), node('Unreachable', 'Unrch')],
    },
  );

  const voice = newVoiceSurvey(id('sv'), id('e'), 'Standard CSAT');
  voice.def = true;
  voice.entries = [
    { id: id('e'), rec: 'Rate your experience', dtmf: '1', dest: 'Next Recording' },
    { id: id('e'), rec: 'Thanks for calling', dtmf: '2', dest: 'Hangup' },
  ];
  voice.inv = { rec: 'TEST', retries: '2', retryRec: 'TEST', dest: 'Repeat question' };
  voice.tmo = { rec: 'TEST', retries: '1', retryRec: 'TEST', dest: 'Hangup' };

  const web = newWebSurvey(id('sv'), id('q'), 'Post-call form');
  web.questions = [
    { id: id('q'), text: 'How would you rate this call?', rtype: 'Dropdown', options: ['Very good', 'Good', 'Poor'] },
    { id: id('q'), text: 'Was the issue resolved?', rtype: 'Dropdown', options: ['Yes', 'No', 'Partly'] },
    { id: id('q'), text: 'Anything else you would like to add?', rtype: 'Short answer', options: [] },
  ];
  db.surveys.push(voice, web);

  /* ------------------------------------------------------------ agent setup */
  db.agentScripts.push({
    id: id('as'),
    name: 'Collections opener',
    def: true,
    codes: ['Greeting', 'Verification', 'Offer', 'Close'],
  });
  db.pauseCodeSets.push(
    { id: id('pc'), name: 'Standard breaks', def: true, codes: ['Break', 'Lunch', 'Training', 'Meeting', 'System issue'] },
    { id: id('pc'), name: 'SMFG Pause codes', codes: ['Tea', 'Lunch', 'Huddle', 'Coaching', 'Tech down'] },
  );
  db.skillLists.push(
    { id: id('sk'), name: 'Default skills', def: true, codes: ['Hindi', 'English', 'Marathi'] },
    { id: id('sk'), name: 'HFC skills', codes: ['HFC West', 'HFC North'] },
  );
  db.transferDirectories.push(
    {
      id: id('td'),
      name: 'Escalations',
      def: true,
      desc: 'Supervisor and back-office desks',
      entries: [
        { id: id('t'), name: 'Supervisor desk', number: '+912261780110' },
        { id: id('t'), name: 'Legal', number: '+912261780145' },
        { id: id('t'), name: 'Branch ops — West', number: '+912261780162' },
      ],
    },
    {
      id: id('td'),
      name: 'Field teams',
      desc: 'Recovery officers on the ground',
      entries: [
        { id: id('t'), name: '31009 Parag SPM', number: '+919724986233' },
        { id: id('t'), name: '31009 Sarfaraz jdm', number: '+912307300333' },
      ],
    },
  );

  /* -------------------------------------------------------------- campaigns */
  const byName = (arr: Array<{ id: string; name: string }>, name: string) =>
    arr.find((x) => x.name === name)?.id ?? '';

  const mkCampaign = (
    name: string,
    desc: string,
    status: 'running' | 'draft',
    values: Record<string, unknown>,
  ): StoredCampaign => {
    const v = { ...CAMPAIGN_DEFAULTS, ...values } as any;
    delete v.queues;
    const c: StoredCampaign = {
      id: id('c'),
      name,
      desc,
      status,
      values: v,
      published: JSON.parse(JSON.stringify(v)),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    db.campaigns.push(c);
    return c;
  };

  const westHfc = mkCampaign('WEST HFC', 'West region housing finance recovery', 'running', {
    name: 'WEST HFC',
    description: 'West region housing finance recovery',
    dialMethod: 'Predictive',
    pacingRatio: '2.5',
    maxAbandon: '3',
    wrapUp: '60',
    acw: '0',
    callQual: '20',
    ringTimeout: '40',
    agentGroup: 'HFC West',
    dispositionList: byName(db.dispositionSets, 'SMFG'),
    enforcePause: true,
    pauseCodeList: byName(db.pauseCodeSets, 'SMFG Pause codes'),
    agentOnlyCallback: true,
    allowHangup: true,
    allowTransfer: true,
    externalTransfer: true,
    quickTransfer: byName(db.transferDirectories, 'Escalations'),
    skillRouting: true,
    skillList: byName(db.skillLists, 'HFC skills'),
    dndList: dnd.id,
    callerId: ['022 6178 0100', '+91 90040 22110', '1800 209 5000'],
    leadLists: [west.id, bounce.id],
    inbound: true,
  });

  mkCampaign('North Collections Q3', 'Bucket 2 recovery, north zone', 'running', {
    name: 'North Collections Q3',
    description: 'Bucket 2 recovery, north zone',
    dialMethod: 'Progressive',
    agentGroup: 'Collections North',
    wrapUp: '45',
    acw: '0',
    ringTimeout: '30',
    dispositionList: byName(db.dispositionSets, 'Standard outcomes'),
    callerId: ['1800 209 5000'],
    leadLists: [west.id],
  });

  mkCampaign('Renewal Outreach', 'Policy renewal reminders', 'draft', {
    name: 'Renewal Outreach',
    description: 'Policy renewal reminders',
    dialMethod: 'Preview',
    previewTimeout: '15',
    agentGroup: 'Retention',
    wrapUp: '45',
    acw: '0',
    ringTimeout: '30',
    dispositionList: byName(db.dispositionSets, 'Standard outcomes'),
    callerId: ['1800 209 5000'],
    leadLists: [renewal.id],
  });

  /* -------------------------------------- owned queues (stored standalone) */
  const q1: StoredQueue = {
    ...newQueue(id('q'), 'WEST HFC collections'),
    campaignId: westHfc.id,
    dids: ['1800 209 5000'],
    agents: ['Kimi', 'Aakriti', 'Saksham', 'Karan Chhabra'],
    priority: true,
    tiers: { Kimi: 1, Aakriti: 1, Saksham: 2, 'Karan Chhabra': 3 },
    strategy: 'Fewest calls',
    sticky: 'Yes',
    stickyTimeFormat: '7 days',
    stickyFailover: 'Follow queue strategy',
    callback: true,
    threshold: '45',
    dtmf: '9',
    welcome: 'Standard greeting',
    moh: 'Corporate loop',
    sla: '20',
    transferCode: '101',
  };
  const q2: StoredQueue = {
    ...newQueue(id('q'), 'WEST HFC escalations'),
    campaignId: westHfc.id,
    dids: ['022 6178 0155'],
    agents: ['Gurneet Singh'],
    strategy: 'Longest wait time',
    failoverDest: 'Voicemail',
    queueTimeout: '120',
    transferCode: '102',
  };
  db.queues.push(q1, q2);
  db.queues.forEach((q) => {
    const { campaignId: _c, publishedSnapshot: _p, ...clean } = q;
    q.publishedSnapshot = JSON.parse(JSON.stringify(clean));
  });

  return db;
}

/** Codes present at seed time, grandfathered under POLICY.legacyCodes. */
export function legacyCodeSet(db: Db): Set<string> {
  const out = new Set<string>();
  db.dispositionSets.forEach((set) => {
    const walkTree = (nodes: DispositionNode[]) =>
      nodes.forEach((n) => {
        if (n.code) out.add(n.code.toLowerCase());
        walkTree(n.children);
      });
    walkTree(set.tree);
  });
  return out;
}

export { suggestCode, uniqueCode };
