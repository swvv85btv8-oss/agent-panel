import {
  CampaignValues,
  DialMethod,
  LibraryGroup,
  PacingDef,
  PhaseDef,
  SectionDef,
} from './types';

/**
 * THE FIELD MODEL.
 *
 * Adding a setting must be a data change here and nothing else — never new JSX.
 * Every dependent field sits adjacent to the toggle that reveals it, in the same
 * section, because progressive disclosure is useless if the revealed field is
 * somewhere the user has to go looking for it.
 */

export const LIBRARY_GROUPS: LibraryGroup[] = [
  {
    id: 'leaddata',
    title: 'Lead data',
    sub: 'The people you dial, and the shape of their records.',
    keys: ['leads'],
  },
  {
    id: 'outcomes',
    title: 'Call outcomes',
    sub: 'How a call gets evaluated once it ends.',
    keys: ['disposition', 'csat'],
  },
  {
    id: 'agentsetup',
    title: 'Agent setup',
    sub: 'What agents use, and how they are described.',
    keys: ['script', 'quick', 'pause', 'skill'],
  },
  {
    id: 'compliance',
    title: 'Compliance',
    sub: 'Rules about when and whom you may dial.',
    keys: ['dnd'],
  },
];

export const PHASES: PhaseDef[] = [
  { id: 'setup', title: 'Setup', sub: 'What this campaign is, who gets dialed, and by whom.' },
  { id: 'during', title: 'During the call', sub: 'What the agent can see and do while connected.' },
  { id: 'post', title: 'After the call', sub: 'Recording the outcome and what happens next.' },
  { id: 'inbound', title: 'Inbound', sub: 'Calls coming the other way.' },
];

const v = (x: Record<string, unknown>) => x as CampaignValues;

export const SECTIONS: SectionDef[] = [
  {
    id: 'basics',
    title: 'Campaign basics',
    phase: 'setup',
    sub: 'Identity, ownership and the leads this campaign dials.',
    fields: [
      { id: 'name', label: 'Campaign name', kind: 'text', req: true, ph: 'e.g. WEST HFC' },
      { id: 'description', label: 'Description', kind: 'text', ph: 'What this campaign is for' },
      { id: '__leads', kind: 'leads' },
      {
        id: 'callerId',
        label: 'Campaign caller ID',
        kind: 'picker',
        req: true,
        help: 'Numbers shown to the customer.',
      },
      {
        id: 'sharedWith',
        label: 'Shared with',
        kind: 'picker',
        help: 'Other users who can edit this campaign.',
      },
    ],
  },
  {
    id: 'outcomes',
    title: 'Call outcomes',
    phase: 'post',
    sub: 'How each call is evaluated, and what the agent records against it.',
    lib: 'outcomes',
    fields: [
      {
        id: 'dispositionList',
        label: 'Dispositions',
        kind: 'select',
        req: true,
        lib: 'disposition',
        help: 'Outcome codes the agent picks after each call.',
      },
      {
        id: 'enableCsat',
        label: 'Run a CSAT survey',
        kind: 'toggle',
        help: 'Plays a short survey to the customer after the agent hangs up.',
      },
      {
        id: 'csatSurvey',
        label: 'Survey',
        kind: 'select',
        req: true,
        lib: 'csat',
        when: (x) => !!v(x).enableCsat,
        dependsOn: ['enableCsat'],
      },
      {
        id: 'popup',
        label: 'Show a screen pop-up',
        kind: 'toggle',
        help: 'Opens your own page with the lead in context when the call connects.',
      },
      {
        id: 'popupUrl',
        label: 'Screen pop-up URL',
        kind: 'text',
        req: true,
        when: (x) => !!v(x).popup,
        dependsOn: ['popup'],
        ph: 'https://',
      },
      {
        id: 'webform',
        label: 'Collect details on a webform',
        kind: 'toggle',
        help: 'The agent fills this in based on the outcome they select.',
      },
      {
        id: 'webformUrl',
        label: 'Webform URL',
        kind: 'text',
        req: true,
        when: (x) => !!v(x).webform,
        dependsOn: ['webform'],
        ph: 'https://',
      },
    ],
  },
  {
    id: 'dialing',
    title: 'Dialing & pacing',
    phase: 'setup',
    sub: 'How leads are dialed, and what the customer hears.',
    dialing: true,
    fields: [
      {
        id: 'dialMethod',
        label: 'Dial method',
        kind: 'select',
        req: true,
        opts: ['Progressive', 'Predictive', 'Power', 'Ratio', 'Preview'],
      },
      { id: 'wrapUp', label: 'Wrap up time (sec)', kind: 'number', req: true },
      { id: 'acw', label: 'After call work (sec)', kind: 'number', req: true },
      {
        id: 'callQual',
        label: 'Call qualification duration (sec)',
        kind: 'number',
        help: 'Minimum talk time before a call counts as connected.',
      },
      {
        id: 'outAnnounce',
        label: 'Outbound announcement',
        kind: 'select',
        opts: ['', 'Recording disclosure', 'Debt notice'],
        help: 'Played to the customer when the call connects.',
      },
      {
        id: 'moh',
        label: 'Music on hold',
        kind: 'select',
        opts: ['', 'Corporate loop', 'Regional instrumental'],
        help: 'Played when the agent puts the customer on hold.',
      },
    ],
  },
  {
    id: 'agents',
    title: 'Agents',
    phase: 'setup',
    sub: 'Who dials, how they connect, and how calls reach them.',
    lib: 'agentsetup',
    fields: [
      {
        id: 'connMethod',
        label: 'Agent connection method',
        kind: 'select',
        req: true,
        opts: ['Dial Out (Session)', 'Dial In'],
      },
      {
        id: 'agentGroup',
        label: 'Agent group',
        kind: 'select',
        req: true,
        opts: ['HFC West', 'HFC North', 'Collections North', 'Retention'],
      },
      {
        id: 'connectThrough',
        label: 'Connect agent through',
        kind: 'select',
        req: true,
        opts: ['Webphone', 'Softphone', 'PSTN'],
      },
      { id: 'ringTimeout', label: 'Ring timeout (sec)', kind: 'number', req: true },
      {
        id: 'skillRouting',
        label: 'Outbound skill based routing',
        kind: 'toggle',
        help: 'Match leads to agents by skill instead of availability alone.',
      },
      {
        id: 'skillList',
        label: 'Skill list',
        kind: 'select',
        req: true,
        lib: 'skill',
        when: (x) => !!v(x).skillRouting,
        dependsOn: ['skillRouting'],
      },
      {
        id: 'enforcePause',
        label: 'Enforce agent pause code',
        kind: 'toggle',
        help: 'Agents must give a reason when going unavailable.',
      },
      {
        id: 'pauseCodeList',
        label: 'Pause codes',
        kind: 'select',
        req: true,
        lib: 'pause',
        when: (x) => !!v(x).enforcePause,
        dependsOn: ['enforcePause'],
      },
      { id: 'agentOnlyCallback', label: 'Agent only callback', kind: 'toggle' },
      { id: 'agentWiseLeadList', label: 'Agent wise lead list', kind: 'toggle' },
      { id: 'agentWiseCallerId', label: 'Agent wise caller ID', kind: 'toggle' },
    ],
  },
  {
    id: 'agentscreen',
    title: 'Agent screen',
    phase: 'during',
    sub: 'What the agent sees, and what they are allowed to do on a call.',
    lib: 'agentsetup',
    fields: [
      {
        id: 'agentScript',
        label: 'Agent script',
        kind: 'select',
        lib: 'script',
        help: 'Talk track shown alongside the lead.',
      },
      {
        id: 'manualDial',
        label: 'Allow manual dial',
        kind: 'toggle',
        help: 'Agents can dial a number by hand instead of taking the next lead.',
      },
      {
        id: 'manualCallerId',
        label: 'Manual dial caller ID',
        kind: 'text',
        req: true,
        when: (x) => !!v(x).manualDial,
        dependsOn: ['manualDial'],
      },
      {
        id: 'allowHangup',
        label: 'Allow hangup',
        kind: 'toggle',
        help: 'Agents can end a call themselves.',
      },
      {
        id: 'campaignSwitch',
        label: 'Allow campaign switch',
        kind: 'toggle',
        help: 'Agents can move themselves to another campaign.',
      },
    ],
  },
  {
    id: 'transfers',
    title: 'Transfers',
    phase: 'during',
    sub: 'Where agents can send a call, and to whom.',
    lib: 'agentsetup',
    fields: [
      {
        id: 'allowTransfer',
        label: 'Allow transfer / conference',
        kind: 'toggle',
        help: 'Turn this off and no transfer of any kind is available to the agent.',
      },
      {
        id: 'externalTransfer',
        label: 'To an outside number',
        kind: 'toggle',
        when: (x) => !!v(x).allowTransfer,
        dependsOn: ['allowTransfer'],
      },
      {
        id: 'queueTransfer',
        label: 'To another queue',
        kind: 'toggle',
        when: (x) => !!v(x).allowTransfer,
        dependsOn: ['allowTransfer'],
      },
      {
        id: 'quickTransfer',
        label: 'Transfer directory',
        kind: 'select',
        lib: 'quick',
        when: (x) => !!v(x).allowTransfer,
        dependsOn: ['allowTransfer'],
        help: 'Preset destinations the agent can pick in one tap.',
      },
    ],
  },
  {
    id: 'messaging',
    title: 'Messaging',
    phase: 'post',
    sub: 'Automatic SMS and WhatsApp follow-ups.',
    fields: [
      { id: 'messaging', label: 'Enable messaging', kind: 'toggle' },
      { id: 'whatsapp', label: 'Enable WhatsApp', kind: 'toggle' },
      {
        id: 'smsReceived',
        label: 'SMS template — answered call',
        kind: 'select',
        opts: ['', 'Thanks for your time', 'Payment link'],
        when: (x) => !!v(x).messaging,
        dependsOn: ['messaging'],
      },
      {
        id: 'smsMissed',
        label: 'SMS template — missed call',
        kind: 'select',
        opts: ['', 'We tried to reach you', 'Call us back'],
        when: (x) => !!v(x).messaging,
        dependsOn: ['messaging'],
      },
    ],
  },
  {
    id: 'compliance',
    title: 'Compliance',
    phase: 'setup',
    sub: 'Who you may dial, and what agents may see.',
    lib: 'compliance',
    fields: [
      { id: 'dndList', label: 'DND', kind: 'select', lib: 'dnd' },
      { id: 'maskLead', label: 'Mask sensitive lead details', kind: 'toggle' },
      { id: 'updateLead', label: 'Allow agents to update lead details', kind: 'toggle' },
      { id: 'accessLeadData', label: 'Access lead data during disposal', kind: 'toggle' },
      { id: 'feedbackRec', label: 'Enable feedback recording', kind: 'toggle' },
    ],
  },
  {
    id: 'schedule',
    title: 'Schedule',
    phase: 'setup',
    sub: 'When this campaign is allowed to dial.',
    fields: [
      { id: 'activeTime', label: 'Campaign active time', kind: 'select', opts: ['Urban', 'Rural', '24x7'] },
      {
        id: 'activeTimeRec',
        label: 'Out-of-hours recording',
        kind: 'select',
        opts: ['', 'Retry (English)', 'Retry (Hindi)'],
      },
      {
        id: 'holidayCalendar',
        label: 'Holiday calendar',
        kind: 'select',
        opts: ['', 'India national', 'Maharashtra'],
      },
    ],
  },
  {
    id: 'inbound',
    title: 'Inbound calls',
    phase: 'inbound',
    sub: 'Letting customers call this campaign back.',
    fields: [
      {
        id: 'inbound',
        label: 'Enable inbound',
        kind: 'toggle',
        help: 'Creates a queue for return calls to this campaign.',
      },
      { id: '__queue', kind: 'queue', when: (x) => !!v(x).inbound, dependsOn: ['inbound'] },
    ],
  },
  {
    id: 'rechurn',
    title: 'Rechurn & retries',
    phase: 'post',
    sub: 'What happens to leads that did not connect.',
    fields: [
      { id: 'dialStatus', label: 'Dial status', kind: 'text', req: true },
      { id: 'enforceDialStatus', label: 'Enforce dial status', kind: 'toggle' },
      { id: 'refreshCount', label: 'Refresh count', kind: 'number' },
      {
        id: 'traversal',
        label: 'Lead list traversal order',
        kind: 'select',
        opts: ['Newest First', 'Oldest First', 'Round robin'],
      },
      { id: 'autoSchedule', label: 'Enable automatic schedule call', kind: 'toggle' },
      { id: 'autoDispose', label: 'Auto dispose unanswered calls', kind: 'toggle' },
      {
        id: 'retryInterval',
        label: 'Retry interval (min)',
        kind: 'number',
        when: (x) => !!v(x).autoSchedule,
        dependsOn: ['autoSchedule'],
      },
    ],
  },
];

/** Pacing controls, revealed by the Dial method select. Progressive needs none. */
export const PACING: Record<DialMethod, PacingDef> = {
  Progressive: {
    note: 'One lead per available agent. No pacing controls needed.',
    rule: '1 : 1',
    fields: [],
  },
  Predictive: {
    note: 'Over-dials based on live answer rates. Keep abandon under the regulatory ceiling.',
    rule: 'adaptive',
    fields: [
      { id: 'pacingRatio', label: 'Pacing ratio (calls per agent)', kind: 'number', req: true },
      {
        id: 'maxAbandon',
        label: 'Max abandon rate (%)',
        kind: 'number',
        req: true,
        help: 'TRAI ceiling is 3%.',
      },
      {
        id: 'abandonRec',
        label: 'Abandon call recording',
        kind: 'select',
        opts: ['', 'Abandon (English)', 'Abandon (Hindi)'],
      },
    ],
  },
  Power: {
    note: 'Fixed number of lines per agent regardless of answer rate.',
    rule: 'fixed lines',
    fields: [{ id: 'linesPerAgent', label: 'Lines per agent', kind: 'number', req: true }],
  },
  Ratio: {
    note: 'Fixed dial ratio, adjusted manually by the supervisor.',
    rule: 'fixed ratio',
    fields: [{ id: 'dialRatio', label: 'Dial ratio', kind: 'number', req: true }],
  },
  Preview: {
    note: 'Agents see the lead before the call is placed.',
    rule: 'agent-paced',
    fields: [
      { id: 'previewTimeout', label: 'Preview timeout (sec)', kind: 'number', req: true },
      { id: 'autoDialAfterPreview', label: 'Auto dial after preview', kind: 'toggle' },
    ],
  },
};

/** The TRAI ceiling on predictive abandon rate. */
export const MAX_ABANDON_RATE = 3;

/**
 * Help text kept visible in the dense layout. Everything else keeps its help as a
 * tooltip so the grid does not turn into a wall of prose.
 */
export const KEEP_HELP = new Set([
  'callQual',
  'skillRouting',
  'enforcePause',
  'allowTransfer',
  'inbound',
  'webform',
  'moh',
  'outAnnounce',
  'dids',
  'sticky',
  'maxCallers',
  'agentRingTimeout',
  'queueTimeout',
  'sla',
  'strategy',
]);

export const CAMPAIGN_DEFAULTS: CampaignValues = {
  name: '',
  description: '',
  dispositionList: '',
  enableCsat: false,
  csatSurvey: '',
  callerId: [],
  sharedWith: [],
  dialMethod: 'Progressive',
  wrapUp: '',
  acw: '',
  callQual: '',
  connMethod: 'Dial Out (Session)',
  agentGroup: '',
  connectThrough: 'Webphone',
  ringTimeout: '',
  agentScript: '',
  enforcePause: false,
  pauseCodeList: '',
  agentOnlyCallback: false,
  agentWiseLeadList: false,
  agentWiseCallerId: false,
  allowHangup: true,
  allowTransfer: false,
  externalTransfer: false,
  campaignSwitch: false,
  skillRouting: false,
  skillList: '',
  manualDial: false,
  manualCallerId: '',
  moh: '',
  outAnnounce: '',
  webform: false,
  webformUrl: '',
  messaging: false,
  whatsapp: false,
  smsReceived: '',
  smsMissed: '',
  dndList: '',
  maskLead: false,
  updateLead: false,
  accessLeadData: false,
  feedbackRec: false,
  popup: false,
  popupUrl: '',
  activeTime: 'Urban',
  activeTimeRec: '',
  holidayCalendar: '',
  inbound: false,
  queueTransfer: false,
  quickTransfer: '',
  dialStatus: 'New',
  enforceDialStatus: false,
  refreshCount: '0',
  traversal: 'Newest First',
  autoSchedule: false,
  autoDispose: false,
  retryInterval: '',
  pacingRatio: '',
  maxAbandon: '',
  abandonRec: '',
  linesPerAgent: '',
  dialRatio: '',
  previewTimeout: '',
  autoDialAfterPreview: false,
  leadLists: [],
  queues: [],
};

export interface TemplateDef {
  label: string;
  desc: string;
  tag: string;
  values: Partial<CampaignValues>;
}

/** Offered on creation so a minimal campaign is a handful of decisions, not 13. */
export const TEMPLATES: Record<string, TemplateDef> = {
  collections: {
    label: 'Collections',
    desc: 'Predictive pacing, strict DND, pause codes enforced, rechurn on unconnected leads.',
    tag: '6 presets',
    values: {
      dialMethod: 'Predictive',
      pacingRatio: '2.5',
      maxAbandon: '3',
      wrapUp: '60',
      acw: '30',
      dispositionList: 'Standard outcomes',
      pauseCodeList: 'Standard breaks',
      enforcePause: true,
      dndList: 'DND',
      traversal: 'Newest First',
      autoSchedule: true,
      retryInterval: '30',
      activeTime: 'Urban',
    },
  },
  sales: {
    label: 'Sales outbound',
    desc: 'Progressive dialing, agent script attached, transfer and conference enabled.',
    tag: '5 presets',
    values: {
      dialMethod: 'Progressive',
      wrapUp: '45',
      acw: '15',
      dispositionList: 'Standard outcomes',
      agentScript: 'Collections opener',
      allowTransfer: true,
      externalTransfer: true,
      activeTime: 'Urban',
    },
  },
  survey: {
    label: 'Survey',
    desc: 'Preview dialing so agents read context first. CSAT attached, no rechurn.',
    tag: '6 presets',
    values: {
      dialMethod: 'Preview',
      previewTimeout: '15',
      wrapUp: '30',
      acw: '0',
      dispositionList: 'Standard outcomes',
      enableCsat: true,
      csatSurvey: 'Standard CSAT',
      activeTime: 'Urban',
    },
  },
  blank: {
    label: 'Start blank',
    desc: 'Nothing pre-filled. Every setting configured from scratch.',
    tag: 'no presets',
    values: {},
  },
};

/** Sections in lifecycle-phase order, numbered continuously 1–11 across phases. */
export function orderedSections(): SectionDef[] {
  return PHASES.flatMap((p) => SECTIONS.filter((s) => s.phase === p.id));
}

export function sectionOf(fieldId: string): SectionDef | undefined {
  return SECTIONS.find((s) => s.fields.some((f) => f.id === fieldId));
}

export function phaseOf(sectionId: string): PhaseDef | undefined {
  const s = SECTIONS.find((x) => x.id === sectionId);
  return PHASES.find((p) => p.id === s?.phase);
}

/** Max lead lists attachable to one campaign. */
export const MAX_LEAD_LISTS = 3;

export const AGENTS = [
  'Shrish Gulati',
  'Kimi',
  'Aakriti',
  'Saksham',
  'Karan Chhabra',
  'Gurneet Singh',
  'Kanchan Pal',
  'Sakshi',
  'Harshit',
  'Akash Dabas',
];
