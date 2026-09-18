import { DispositionAction, DispositionActionType, DispositionNode } from './types';
import { POLICY } from './policy';

/** Five relational levels is the maximum. */
export const MAX_DEPTH = 5;
/** Codes are exactly this long. */
export const CODE_LENGTH = 3;

export const ACTIONS: Record<
  DispositionActionType,
  { label: string; badge: string; desc: string }
> = {
  dnd: {
    label: 'Add to DND',
    badge: 'DND',
    desc: 'The lead is suppressed from all future dialing.',
  },
  callback: {
    label: 'Schedule a callback',
    badge: 'CALLBACK',
    desc: 'The agent must set a callback time before they can submit.',
  },
  sms: {
    label: 'Send an SMS',
    badge: 'SMS',
    desc: 'The template is triggered as soon as the agent submits.',
  },
};

/* ------------------------------------------------------------------ walking */

export function walk(
  nodes: DispositionNode[],
  fn: (node: DispositionNode, depth: number, path: DispositionNode[]) => void,
  depth = 1,
  path: DispositionNode[] = [],
): void {
  nodes.forEach((n) => {
    fn(n, depth, path);
    walk(n.children, fn, depth + 1, [...path, n]);
  });
}

export function countNodes(tree: DispositionNode[]): number {
  let c = 0;
  walk(tree, () => c++);
  return c;
}

export function maxDepth(tree: DispositionNode[]): number {
  let d = 0;
  walk(tree, (_n, depth) => {
    if (depth > d) d = depth;
  });
  return d;
}

export interface FoundNode {
  node: DispositionNode;
  depth: number;
  path: DispositionNode[];
}

export function findNode(tree: DispositionNode[], id: string): FoundNode | null {
  let found: FoundNode | null = null;
  walk(tree, (n, depth, path) => {
    if (n.id === id) found = { node: n, depth, path: [...path, n] };
  });
  return found;
}

export function removeNode(tree: DispositionNode[], id: string): boolean {
  for (let i = 0; i < tree.length; i++) {
    if (tree[i].id === id) {
      tree.splice(i, 1);
      return true;
    }
    if (removeNode(tree[i].children, id)) return true;
  }
  return false;
}

export function leafPaths(tree: DispositionNode[]): DispositionNode[][] {
  const out: DispositionNode[][] = [];
  walk(tree, (n, _d, path) => {
    if (!n.children.length) out.push([...path, n]);
  });
  return out;
}

/* ------------------------------------------------------------------ cascade */

/**
 * THE CASCADE RULE. Actions run for EVERY node on the path the agent selects, not
 * just the leaf. An action on a level-2 node therefore applies to all its descendants.
 */
export function pathActions(
  path: DispositionNode[],
): Array<{ node: DispositionNode; action: DispositionAction }> {
  return path.filter((n) => n.action).map((n) => ({ node: n, action: n.action! }));
}

/** Every node carrying an action, with the full path that reaches it. */
export function actionNodes(
  tree: DispositionNode[],
): Array<{ node: DispositionNode; path: DispositionNode[] }> {
  const out: Array<{ node: DispositionNode; path: DispositionNode[] }> = [];
  walk(tree, (n, _d, path) => {
    if (n.action) out.push({ node: n, path: [...path, n] });
  });
  return out;
}

/** How many dispositions sit beneath this one, i.e. how far its action reaches. */
export function reachOf(node: DispositionNode): number {
  return countNodes([node]) - 1;
}

/**
 * Actions inherited by a node from its ancestors — rendered as faded/dashed badges
 * so a descendant row shows what it will run without claiming to own it.
 */
export function inheritedActions(
  path: DispositionNode[],
  node: DispositionNode,
): Array<{ type: DispositionActionType; from: string }> {
  return path
    .filter((p) => p.id !== node.id && p.action)
    .map((p) => ({ type: p.action!.type, from: p.name }));
}

export interface PathConflict {
  path: DispositionNode[];
  type: DispositionActionType;
  sources: string[];
}

/**
 * A path that would run the same action twice. Duplicate DND is idempotent — adding a
 * lead to the same list twice is the same outcome — so it is never flagged.
 */
export function conflicts(tree: DispositionNode[]): PathConflict[] {
  const out: PathConflict[] = [];
  const checked: DispositionActionType[] =
    POLICY.callbackConflict === 'child-overrides' ? ['sms'] : ['callback', 'sms'];

  leafPaths(tree).forEach((path) => {
    const actions = pathActions(path);
    checked.forEach((type) => {
      const hits = actions.filter((a) => a.action.type === type);
      if (hits.length > 1) {
        out.push({ path, type, sources: hits.map((h) => h.node.name) });
      }
    });
  });
  return out;
}

/**
 * The action list that actually runs for a path, after the override policy.
 * Under 'child-overrides' the deepest callback wins; under 'flag' both are reported
 * and the conflict list tells the user to resolve it.
 */
export function effectiveActions(
  path: DispositionNode[],
): Array<{ node: DispositionNode; action: DispositionAction }> {
  const all = pathActions(path);
  if (POLICY.callbackConflict !== 'child-overrides') return all;
  const lastCallback = [...all].reverse().find((a) => a.action.type === 'callback');
  return all.filter((a) => a.action.type !== 'callback' || a === lastCallback);
}

/* -------------------------------------------------------------------- codes */

/**
 * Suggest a 3-character code: first letter of each word plus its consonants, take 3.
 * "Interested" -> "Int", "Not Connected" -> "Ntc".
 */
export function suggestCode(name: string): string {
  const words = (name || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  const condensed = words.map((w) => w[0] + w.slice(1).replace(/[aeiou\W\d]/gi, '')).join('');
  const code = (condensed || words.join('')).slice(0, CODE_LENGTH);
  return code.charAt(0).toUpperCase() + code.slice(1).toLowerCase();
}

/**
 * Resolve a collision while staying at 3 characters: Int -> In2 -> In3 ... -> I10.
 */
export function uniqueCode(tree: DispositionNode[], base: string, selfId?: string): string {
  if (!base) return '';
  const taken = new Set<string>();
  walk(tree, (n) => {
    if (n.id !== selfId && n.code) taken.add(n.code.toLowerCase());
  });
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 2; i <= 9; i++) {
    const c = base.slice(0, 2) + i;
    if (!taken.has(c.toLowerCase())) return c;
  }
  for (let i = 10; i <= 99; i++) {
    const c = base.slice(0, 1) + i;
    if (!taken.has(c.toLowerCase())) return c;
  }
  return base;
}

export interface CodeProblem {
  nodeId: string;
  name: string;
  code: string;
  reason: 'duplicate' | 'too-long' | 'missing';
}

/**
 * Code validation. Under the 'grandfather' policy an existing over-length code is left
 * alone — only new and edited codes must be 3 characters — so `legacyCodes` lists the
 * codes that were already in the set when it was loaded.
 */
export function codeProblems(
  tree: DispositionNode[],
  legacyCodes: Set<string> = new Set(),
): CodeProblem[] {
  const out: CodeProblem[] = [];
  const seen = new Map<string, DispositionNode>();
  walk(tree, (n) => {
    if (!n.code) {
      out.push({ nodeId: n.id, name: n.name, code: '', reason: 'missing' });
      return;
    }
    const grandfathered =
      POLICY.legacyCodes === 'grandfather' && legacyCodes.has(n.code.toLowerCase());
    if (n.code.length > CODE_LENGTH && !grandfathered) {
      out.push({ nodeId: n.id, name: n.name, code: n.code, reason: 'too-long' });
    }
    const key = n.code.toLowerCase();
    if (seen.has(key)) {
      out.push({ nodeId: n.id, name: n.name, code: n.code, reason: 'duplicate' });
    } else {
      seen.set(key, n);
    }
  });
  return out;
}

/** Every code currently in a tree, for grandfathering on load. */
export function collectCodes(tree: DispositionNode[]): Set<string> {
  const out = new Set<string>();
  walk(tree, (n) => {
    if (n.code) out.add(n.code.toLowerCase());
  });
  return out;
}

/* ------------------------------------------------------------- bulk upload */

export interface BulkResult {
  added: number;
  matched: number;
  skipped: number;
  /** Lines rejected for exceeding the depth limit, reported with a count. */
  tooDeep: number;
  errors: string[];
}

export function makeNode(
  id: string,
  name: string,
  code: string,
  action: DispositionAction | null = null,
): DispositionNode {
  return { id, name, code, status: 'Enabled', action, children: [] };
}

function actionFromKeyword(word: string): DispositionAction | null {
  const w = word.trim().toLowerCase();
  if (w === 'dnd') return { type: 'dnd', dndList: 'DND' };
  if (w === 'callback') return { type: 'callback', window: '24' };
  if (w === 'sms') return { type: 'sms', template: '' };
  return null;
}

/**
 * Merge a whole tree from one file. One path per line, `>`-separated, with an optional
 * `[code]` per segment and an optional `| action` at the end:
 *
 *   Connected [Con] > Interested [Int] > Ready to pay
 *   Connected > Not interested | dnd
 *
 * Existing branches match by name, so re-uploading only adds what is missing.
 */
export function bulkMerge(
  tree: DispositionNode[],
  text: string,
  newId: () => string,
): BulkResult {
  const result: BulkResult = { added: 0, matched: 0, skipped: 0, tooDeep: 0, errors: [] };
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  lines.forEach((line, lineNo) => {
    const [pathPart, actionPart] = line.split('|').map((s) => (s ? s.trim() : s));
    const segments = pathPart
      .split('>')
      .map((s) => s.trim())
      .filter(Boolean);

    if (!segments.length) {
      result.skipped++;
      return;
    }
    if (segments.length > MAX_DEPTH) {
      result.tooDeep++;
      result.errors.push(
        `Line ${lineNo + 1}: ${segments.length} levels exceeds the maximum of ${MAX_DEPTH}`,
      );
      return;
    }

    let level = tree;
    let node: DispositionNode | null = null;
    segments.forEach((segment) => {
      const m = segment.match(/^(.*?)\s*(?:\[(.*?)\])?$/);
      const name = (m?.[1] ?? segment).trim();
      const code = (m?.[2] ?? '').trim();
      let existing = level.find((x) => x.name.toLowerCase() === name.toLowerCase());
      if (existing) {
        result.matched++;
      } else {
        existing = makeNode(newId(), name, code || uniqueCode(tree, suggestCode(name)));
        level.push(existing);
        result.added++;
      }
      node = existing;
      level = existing.children;
    });

    if (actionPart && node) {
      const action = actionFromKeyword(actionPart);
      if (action) (node as DispositionNode).action = action;
      else result.errors.push(`Line ${lineNo + 1}: unknown action "${actionPart}"`);
    }
  });

  return result;
}
