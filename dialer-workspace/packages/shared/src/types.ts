/**
 * Domain types shared by the client and the server.
 *
 * The single architectural rule (see README §2): objects split on whether they
 * exist independently of any campaign.
 *   - CAMPAIGN-OWNED : InboundQueue. Created with a campaign, never shared, cascade-deleted.
 *   - SHARED LIBRARY : everything else. Reusable, seeded by default, creatable inline.
 */

/* ------------------------------------------------------------------ library */

/** The four library groups. These exact words are used in the nav AND the campaign form. */
export type LibraryGroupId = 'leaddata' | 'outcomes' | 'agentsetup' | 'compliance';

export type LibraryKey =
  | 'leads'
  | 'disposition'
  | 'csat'
  | 'script'
  | 'quick'
  | 'pause'
  | 'skill'
  | 'dnd';

export interface LibraryGroup {
  id: LibraryGroupId;
  title: string;
  sub: string;
  keys: LibraryKey[];
}

/* --------------------------------------------------------------- lead lists */

/** The 6 fixed columns. `phone` is dialed and `altphone` is a real number: neither may be masked. */
export interface FixedColumn {
  key: 'phone' | 'name' | 'email' | 'address' | 'company' | 'altphone';
  label: string;
  note: string;
  /** phone cannot be renamed or removed. */
  lock?: boolean;
  /** phone + altphone can never be marked sensitive. */
  nosens?: boolean;
  sensitive: boolean;
}

export interface CustomColumn {
  id: string;
  label: string;
  /** Masked in the agent panel. */
  sensitive: boolean;
  /** Excluded from the agent panel AND from the generated sample CSV. */
  hidden: boolean;
}

export interface LeadList {
  id: string;
  name: string;
  desc: string;
  /** Record count. Records themselves are paginated server-side, never embedded. */
  records: number;
  updated: string;
  fixed: FixedColumn[];
  custom: CustomColumn[];
}

export type LeadRecord = Record<string, string> & { id?: string };

export type DuplicateMode = 'skip' | 'overwrite' | 'clone';
export type DedupeScope = 'list' | 'all';

/* ------------------------------------------------------------- dispositions */

export type DispositionActionType = 'dnd' | 'callback' | 'sms';

export type DispositionAction =
  | { type: 'dnd'; dndList: string }
  | { type: 'callback'; window: string }
  | { type: 'sms'; template: string };

export interface DispositionNode {
  id: string;
  name: string;
  /** Exactly 3 characters, unique within the set. */
  code: string;
  status: 'Enabled' | 'Disabled';
  action: DispositionAction | null;
  children: DispositionNode[];
  /** true while the code is still being auto-suggested from the name. */
  autoCode?: boolean;
}

export interface DispositionSet {
  id: string;
  name: string;
  def?: boolean;
  tree: DispositionNode[];
}

/* ------------------------------------------------------------------ surveys */

export type SurveyType = 'voice' | 'web';

export interface VoiceEntry {
  id: string;
  rec: string;
  dtmf: string;
  dest: string;
}

export interface VoiceFallback {
  rec: string;
  retries: string;
  retryRec: string;
  dest: string;
}

export type ResponseType =
  | 'Dropdown'
  | 'Checkboxes (multiple)'
  | 'Short answer'
  | 'Date'
  | 'Date/Time';

export interface WebQuestion {
  id: string;
  text: string;
  rtype: ResponseType;
  options: string[];
}

export interface VoiceSurvey {
  id: string;
  name: string;
  desc: string;
  /** Immutable after creation — converting would discard every type-specific setting. */
  type: 'voice';
  def?: boolean;
  digitTimeout: string;
  entries: VoiceEntry[];
  inv: VoiceFallback;
  tmo: VoiceFallback;
}

export interface WebSurvey {
  id: string;
  name: string;
  desc: string;
  type: 'web';
  def?: boolean;
  questions: WebQuestion[];
}

export type Survey = VoiceSurvey | WebSurvey;

/* ------------------------------------------------- dnd / transfer / simple */

export interface DndEntry {
  id: string;
  value: string;
  /** A Number blocks that line; a Prefix blocks everything starting with it. */
  type: 'Number' | 'Prefix';
}

export interface DndList {
  id: string;
  name: string;
  desc: string;
  def?: boolean;
  /** Entry count; entries are paginated server-side. */
  count: number;
}

export interface TransferEntry {
  id: string;
  name: string;
  number: string;
}

export interface TransferDirectory {
  id: string;
  name: string;
  desc: string;
  def?: boolean;
  entries: TransferEntry[];
}

/** PauseCodeSet / SkillList / AgentScript all share this shape. */
export interface SimpleLibItem {
  id: string;
  name: string;
  def?: boolean;
  codes: string[];
}

/* ------------------------------------------------------------ inbound queue */

export interface InboundQueue {
  id: string;
  name: string;
  desc: string;
  /** Required. A DID may point at only one queue account-wide. */
  dids: string[];
  strategy: string;
  queueTimeout: string;
  agentRingTimeout: string;
  transferCode: string;
  intercomId: string;
  failoverDest: string;
  failoverMusic: string;
  sticky: 'No' | 'Yes';
  stickyTimeFormat: string;
  stickyFailover: string;
  stickyFailoverRec: string;
  welcome: string;
  moh: string;
  waitAnnounce: boolean;
  waitRec: string;
  positionAnnounce: boolean;
  positionRec: string;
  queueLimit: boolean;
  maxCallers: string;
  limitAction: string;
  repeatCaller: boolean;
  repeatDays: string;
  smsReceived: string;
  smsMissedCaller: string;
  smsMissedAgent: string;
  waReceived: string;
  waMissed: string;
  agents: string[];
  /** Tiered fallback, not a per-agent integer priority. */
  priority: boolean;
  tiers: Record<string, 1 | 2 | 3>;
  callback: boolean;
  threshold: string;
  dtmf: string;
  thresholdRec: string;
  hangupRec: string;
  sla: string;
  [key: string]: unknown;
}

/* ---------------------------------------------------------------- campaign */

export type DialMethod = 'Progressive' | 'Predictive' | 'Power' | 'Ratio' | 'Preview';

/** The editable value bag for a campaign. Indexed because the form is data-driven. */
export interface CampaignValues {
  name: string;
  description: string;
  /** References shared Lead Lists. Max 3. */
  leadLists: string[];
  /** Owned children, cascade-deleted with the campaign. */
  queues: InboundQueue[];
  dialMethod: DialMethod;
  [key: string]: unknown;
}

export interface CampaignSummary {
  id: string;
  name: string;
  desc: string;
  method: DialMethod;
  status: 'running' | 'draft';
  agents: string;
  lists: string[];
  queues: number;
}

export interface Campaign extends CampaignSummary {
  values: CampaignValues;
  /** Last published values; the client diffs against this for dirty tracking. */
  published: CampaignValues;
}

/* ------------------------------------------------------------ field model */

export type FieldKind =
  | 'text'
  | 'number'
  | 'select'
  | 'toggle'
  | 'picker'
  | 'chips'
  | 'leads'
  | 'queue'
  | 'agents';

export interface FieldDef {
  id: string;
  label?: string;
  kind: FieldKind;
  /** Always required, or required whenever `when` passes. */
  req?: boolean;
  opts?: string[];
  /** Options come from this library collection, and the field gets a `+ New` affordance. */
  lib?: LibraryKey;
  help?: string;
  ph?: string;
  /**
   * Progressive disclosure predicate. A hidden field is excluded from validation.
   */
  when?: (v: Record<string, unknown>) => boolean;
  /**
   * Field ids this field's `when` predicate reads. Declared explicitly rather than
   * parsed out of the function source, which a minified production build would break.
   */
  dependsOn?: string[];
  /** Shows the campaign's value beside a twinned queue field, read-only. Never copies it. */
  cmp?: string;
}

export interface SectionDef {
  id: string;
  title: string;
  sub: string;
  phase: PhaseId;
  /** Tags the section with the library group whose words the nav also uses. */
  lib?: LibraryGroupId;
  /** The dialing section hosts the pacing block, which varies by dial method. */
  dialing?: boolean;
  fields: FieldDef[];
}

export type PhaseId = 'setup' | 'during' | 'post' | 'inbound';

export interface PhaseDef {
  id: PhaseId;
  title: string;
  sub: string;
}

export interface QueueSectionDef {
  id: string;
  title: string;
  sub: string;
  fields: FieldDef[];
}

export interface PacingDef {
  note: string;
  rule: string;
  fields: FieldDef[];
}

/* -------------------------------------------------------------- validation */

export interface Issue {
  /** Field id, or a synthetic id such as `__leads` / `queues` / `dids`. */
  id: string;
  label: string;
  /** Section the issue lives in, so the UI can jump to it. */
  sec: string;
  secTitle: string;
  /** Set when the issue belongs to an owned queue. */
  qid?: string;
  qname?: string;
  /** Set for DID collisions. */
  dup?: boolean;
}

export interface ValidationError {
  /** Field-keyed so the client can attach the message to the right input. */
  field: string;
  message: string;
  section?: string;
  queueId?: string;
}

/* ------------------------------------------------------------------- misc */

export interface UsageCount {
  id: string;
  campaigns: number;
}
