import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MAX_DEPTH,
  bulkMerge,
  codeProblems,
  collectCodes,
  conflicts,
  countNodes,
  effectiveActions,
  findNode,
  inheritedActions,
  makeNode,
  maxDepth,
  pathActions,
  reachOf,
  removeNode,
  suggestCode,
  uniqueCode,
} from '../src';
import { DispositionNode } from '../src/types';

let n = 0;
const nid = () => `n${++n}`;
const node = (name: string, code = '', children: DispositionNode[] = [], action: any = null) => {
  const x = makeNode(nid(), name, code, action);
  x.children = children;
  return x;
};

const tree = (): DispositionNode[] => [
  node('Connected', 'Con', [
    node('Interested', 'Int', [node('Ready to pay', 'Rdy')]),
    node('Not interested', 'Not', [], { type: 'dnd', dndList: 'DND' }),
    node('Call back later', 'Clb', [], { type: 'callback', window: '24' }),
  ]),
  node('Not Connected', 'Ntc', [node('Busy', 'Bsy', [], { type: 'sms', template: 'We tried' })]),
];

describe('code suggestion', () => {
  it('takes the first letter of each word plus consonants, 3 characters', () => {
    assert.equal(suggestCode('Interested'), 'Int');
    assert.equal(suggestCode('Not Connected'), 'Ntc');
    assert.equal(suggestCode('Payment Done'), 'Pym');
  });

  it('returns empty for an empty name', () => {
    assert.equal(suggestCode(''), '');
    assert.equal(suggestCode('   '), '');
  });

  it('always produces at most 3 characters', () => {
    ['Extraordinarily Long Disposition Name', 'X', 'Ab Cd Ef Gh'].forEach((name) => {
      assert.ok(suggestCode(name).length <= 3);
    });
  });

  it('capitalises only the first letter', () => {
    // Per word it takes the first letter plus that word's consonants, concatenates,
    // then slices to 3: ready|to|pay -> rdy + t + py -> "Rdy".
    assert.equal(suggestCode('ready to pay'), 'Rdy');
  });
});

describe('code collisions', () => {
  it('resolves Int -> In2 -> In3, staying at 3 characters', () => {
    const t = [node('Interested', 'Int')];
    const second = uniqueCode(t, 'Int');
    assert.equal(second, 'In2');
    t.push(node('Interested too', second));
    assert.equal(uniqueCode(t, 'Int'), 'In3');
  });

  it('never grows past 3 characters even after many collisions', () => {
    const t: DispositionNode[] = [];
    for (let i = 0; i < 20; i++) {
      const c = uniqueCode(t, 'Int');
      assert.equal(c.length, 3, `collision ${i} produced "${c}"`);
      t.push(node('x' + i, c));
    }
  });

  it('ignores the node being edited when checking its own code', () => {
    const t = tree();
    const found = findNode(t, t[0].children[0].id)!;
    assert.equal(uniqueCode(t, 'Int', found.node.id), 'Int');
  });

  it('flags duplicates and over-length codes', () => {
    const t = [node('A', 'Dup'), node('B', 'Dup'), node('C', 'Toolong')];
    const problems = codeProblems(t);
    assert.ok(problems.some((p) => p.reason === 'duplicate'));
    assert.ok(problems.some((p) => p.reason === 'too-long'));
  });

  it('grandfathers codes that were already in the set', () => {
    // Existing production codes are 4-5 characters (Pytd, Plcyi).
    const t = [node('Payment done', 'Pytd'), node('Policy issued', 'Plcyi')];
    const legacy = collectCodes(t);
    assert.equal(codeProblems(t, legacy).filter((p) => p.reason === 'too-long').length, 0);
    // A newly typed over-length code is still rejected.
    t.push(node('New one', 'Toolong'));
    assert.equal(codeProblems(t, legacy).filter((p) => p.reason === 'too-long').length, 1);
  });
});

describe('cascade semantics', () => {
  it('runs every action on the path, not just the leaf', () => {
    const t = [
      node('Connected', 'Con', [
        node('Refuse', 'Rfs', [node('Do not call', 'Dnc')]),
      ], { type: 'sms', template: 'x' }),
    ];
    const leaf = findNode(t, t[0].children[0].children[0].id)!;
    const actions = pathActions(leaf.path);
    assert.equal(actions.length, 1);
    assert.equal(actions[0].node.name, 'Connected');
  });

  it('reports how far a parent action reaches', () => {
    const t = tree();
    assert.equal(reachOf(t[0]), 4); // Connected has 4 descendants
    assert.equal(reachOf(t[0].children[0]), 1);
    assert.equal(reachOf(t[0].children[1]), 0);
  });

  it('lists inherited actions separately from the node own action', () => {
    const t = [
      node('Parent', 'Par', [node('Child', 'Chi', [], { type: 'sms', template: 'x' })], {
        type: 'dnd',
        dndList: 'DND',
      }),
    ];
    const child = findNode(t, t[0].children[0].id)!;
    const inherited = inheritedActions(child.path, child.node);
    assert.equal(inherited.length, 1);
    assert.equal(inherited[0].type, 'dnd');
    assert.equal(inherited[0].from, 'Parent');
  });
});

describe('conflict detection', () => {
  it('flags two callbacks on one path', () => {
    const t = [
      node('A', 'A', [node('B', 'B', [], { type: 'callback', window: '12' })], {
        type: 'callback',
        window: '24',
      }),
    ];
    const c = conflicts(t);
    assert.equal(c.length, 1);
    assert.equal(c[0].type, 'callback');
    assert.deepEqual(c[0].sources, ['A', 'B']);
  });

  it('flags two SMS sends on one path', () => {
    const t = [
      node('A', 'A', [node('B', 'B', [], { type: 'sms', template: 'y' })], {
        type: 'sms',
        template: 'x',
      }),
    ];
    assert.equal(conflicts(t)[0].type, 'sms');
  });

  it('does NOT flag duplicate DND, which is idempotent', () => {
    const t = [
      node('A', 'A', [node('B', 'B', [], { type: 'dnd', dndList: 'DND' })], {
        type: 'dnd',
        dndList: 'DND',
      }),
    ];
    assert.equal(conflicts(t).length, 0);
  });

  it('leaves a clean tree alone', () => {
    assert.equal(conflicts(tree()).length, 0);
  });

  it('keeps both callbacks in the effective list under the flag policy', () => {
    const t = [
      node('A', 'A', [node('B', 'B', [], { type: 'callback', window: '12' })], {
        type: 'callback',
        window: '24',
      }),
    ];
    const leaf = findNode(t, t[0].children[0].id)!;
    assert.equal(effectiveActions(leaf.path).length, 2);
  });
});

describe('tree operations', () => {
  it('counts nodes and depth', () => {
    const t = tree();
    assert.equal(countNodes(t), 7);
    assert.equal(maxDepth(t), 3);
  });

  it('removes a node and everything under it', () => {
    const t = tree();
    // Removing "Interested" takes "Ready to pay" with it.
    removeNode(t, t[0].children[0].id);
    assert.equal(countNodes(t), 5);
  });

  it('caps depth at five levels', () => {
    assert.equal(MAX_DEPTH, 5);
  });
});

describe('bulk upload', () => {
  it('creates a whole path from one line', () => {
    const t: DispositionNode[] = [];
    const r = bulkMerge(t, 'Connected [Con] > Interested [Int] > Ready to pay', nid);
    assert.equal(r.added, 3);
    assert.equal(maxDepth(t), 3);
    assert.equal(t[0].code, 'Con');
  });

  it('matches existing branches by name so re-upload only adds what is missing', () => {
    const t: DispositionNode[] = [];
    bulkMerge(t, 'Connected > Interested', nid);
    const r = bulkMerge(t, 'Connected > Interested > Ready to pay', nid);
    assert.equal(r.matched, 2);
    assert.equal(r.added, 1);
    assert.equal(countNodes(t), 3);
  });

  it('matches branch names case-insensitively', () => {
    const t: DispositionNode[] = [];
    bulkMerge(t, 'Connected', nid);
    const r = bulkMerge(t, 'CONNECTED > Sub', nid);
    assert.equal(r.matched, 1);
    assert.equal(t.length, 1);
  });

  it('attaches an action from the pipe suffix', () => {
    const t: DispositionNode[] = [];
    bulkMerge(t, 'Connected > Not interested | dnd', nid);
    assert.equal(t[0].children[0].action?.type, 'dnd');
  });

  it('rejects lines deeper than five levels and reports the count', () => {
    const t: DispositionNode[] = [];
    const r = bulkMerge(t, 'a > b > c > d > e > f\ng > h', nid);
    assert.equal(r.tooDeep, 1);
    assert.equal(r.errors.length, 1);
    assert.match(r.errors[0], /exceeds the maximum of 5/);
    assert.equal(countNodes(t), 2); // only the valid line landed
  });

  it('accepts a line at exactly five levels', () => {
    const t: DispositionNode[] = [];
    const r = bulkMerge(t, 'a > b > c > d > e', nid);
    assert.equal(r.tooDeep, 0);
    assert.equal(maxDepth(t), 5);
  });

  it('auto-suggests a code when the line omits one', () => {
    const t: DispositionNode[] = [];
    bulkMerge(t, 'Not Connected', nid);
    assert.equal(t[0].code, 'Ntc');
  });

  it('reports an unknown action instead of silently dropping it', () => {
    const t: DispositionNode[] = [];
    const r = bulkMerge(t, 'Connected | teleport', nid);
    assert.equal(r.errors.length, 1);
    assert.match(r.errors[0], /unknown action/);
  });
});
