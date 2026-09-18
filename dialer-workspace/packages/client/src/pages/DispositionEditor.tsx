import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ACTIONS,
  DispositionAction,
  DispositionActionType,
  DispositionNode,
  MAX_DEPTH,
  actionNodes,
  conflicts,
  countNodes,
  effectiveActions,
  findNode,
  inheritedActions,
  maxDepth,
  reachOf,
  removeNode,
  suggestCode,
  uniqueCode,
} from '@dialer/shared';
import { ApiFailure, api } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { BackLink, useShell } from '../components/Shell';
import { Modal } from '../components/primitives';

interface SetResponse {
  id: string;
  name: string;
  tree: DispositionNode[];
  def?: boolean;
}

const newId = () => `n_${Math.random().toString(36).slice(2, 10)}`;

function makeNode(name = '', code = ''): DispositionNode {
  return { id: newId(), name, code, status: 'Enabled', action: null, children: [], autoCode: true };
}

export default function DispositionEditor() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const from = params.get('from');
  const nav = useNavigate();
  const { setCrumb, setRail, setFooter } = useShell();

  const { data } = useAsync<SetResponse>(() => api.get(`/disposition-sets/${id}`), [id]);
  const [name, setName] = useState('');
  const [tree, setTree] = useState<DispositionNode[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [bulkOpen, setBulkOpen] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    setName(data.name);
    setTree(data.tree);
  }, [data]);

  const actions = useMemo(() => actionNodes(tree), [tree]);
  const clashes = useMemo(() => conflicts(tree), [tree]);
  const found = selected ? findNode(tree, selected) : null;

  const commit = useCallback(
    async (next: DispositionNode[]) => {
      setTree(next);
      try {
        await api.put(`/disposition-sets/${id}/tree`, { tree: next });
        setError(null);
      } catch (e) {
        setError(e instanceof ApiFailure ? (e.errors[0]?.message ?? e.message) : 'Could not save');
      }
    },
    [id],
  );

  /** Structural edits clone the tree so React sees a new reference. */
  const mutate = useCallback(
    (fn: (draft: DispositionNode[]) => void) => {
      const draft = JSON.parse(JSON.stringify(tree)) as DispositionNode[];
      fn(draft);
      commit(draft);
    },
    [tree, commit],
  );

  useEffect(() => {
    setCrumb(
      <>
        <Link to="/library/dispositions">Dispositions</Link>
        <span className="sep">/</span>
        <b>{name || 'Untitled'}</b>
      </>,
    );
  }, [setCrumb, name]);

  useEffect(() => {
    setRail(<BackLink label={from ? 'Back to campaign' : 'All disposition sets'} to={from ?? '/library/dispositions'} />);
  }, [setRail, from]);

  useEffect(() => {
    const dnd = actions.filter((a) => a.node.action?.type === 'dnd').length;
    setFooter(
      <>
        <div className="st">
          {countNodes(tree)} dispositions · {actions.length} with an action
          {dnd ? ` · ${dnd} suppress the lead permanently` : ''}
          {error ? <span style={{ marginLeft: 10, color: 'var(--dangerText)' }}>{error}</span> : null}
        </div>
        <div className="act">
          <button className="btn pri" onClick={() => nav(from ?? '/library/dispositions')} type="button">
            Done
          </button>
        </div>
      </>,
    );
  }, [setFooter, tree, actions, error, nav, from]);

  useEffect(
    () => () => {
      setRail(null);
      setFooter(null);
    },
    [setRail, setFooter],
  );

  const addNode = (parentId: string | null) => {
    const node = makeNode();
    mutate((draft) => {
      if (!parentId) {
        draft.push(node);
        return;
      }
      const parent = findNode(draft, parentId);
      if (!parent || parent.depth >= MAX_DEPTH) return;
      parent.node.children.push(node);
    });
    if (parentId) setCollapsed((c) => ({ ...c, [parentId]: false }));
    setSelected(node.id);
  };

  const rename = (nodeId: string, value: string) => {
    mutate((draft) => {
      const target = findNode(draft, nodeId);
      if (!target) return;
      target.node.name = value;
      // While the code is still auto-suggested, it tracks the name.
      if (target.node.autoCode) {
        target.node.code = uniqueCode(draft, suggestCode(value), nodeId);
      }
    });
  };

  const setCode = (nodeId: string, value: string) => {
    mutate((draft) => {
      const target = findNode(draft, nodeId);
      if (!target) return;
      target.node.code = value.slice(0, 3);
      target.node.autoCode = false;
    });
  };

  const setAction = (nodeId: string, type: '' | DispositionActionType) => {
    mutate((draft) => {
      const target = findNode(draft, nodeId);
      if (!target) return;
      target.node.action = !type
        ? null
        : type === 'dnd'
          ? { type: 'dnd', dndList: '' }
          : type === 'callback'
            ? { type: 'callback', window: '24' }
            : { type: 'sms', template: '' };
    });
  };

  const editAction = (nodeId: string, patch: Partial<Record<string, string>>) => {
    mutate((draft) => {
      const target = findNode(draft, nodeId);
      if (target?.node.action) Object.assign(target.node.action, patch);
    });
  };

  const toggleStatus = (nodeId: string) => {
    mutate((draft) => {
      const target = findNode(draft, nodeId);
      if (target) target.node.status = target.node.status === 'Enabled' ? 'Disabled' : 'Enabled';
    });
  };

  const del = (nodeId: string) => {
    const target = findNode(tree, nodeId);
    if (!target) return;
    const below = countNodes([target.node]) - 1;
    if (below && !window.confirm(`Delete this disposition and the ${below} below it?`)) return;
    mutate((draft) => {
      removeNode(draft, nodeId);
    });
    setSelected(null);
  };

  return (
    <div className="wrap wide">
      <div className="pagehead">
        <div>
          <span className="grouptag">Call outcomes</span>
          <h1 style={{ marginTop: 8 }}>
            <input
              className="h1edit"
              defaultValue={name}
              key={data?.id}
              placeholder="Name this disposition set"
              aria-label="Disposition set name"
              onBlur={async (e) => {
                setName(e.target.value);
                await api.patch(`/disposition-sets/${id}`, { name: e.target.value });
              }}
            />
          </h1>
          <p>
            {countNodes(tree)} dispositions across {maxDepth(tree)} level
            {maxDepth(tree) === 1 ? '' : 's'} · {actions.length} with an action attached
          </p>
        </div>
        <div className="act">
          <button className="btn sec" onClick={() => setBulkOpen(true)} type="button">
            Upload tree
          </button>
          <button className="btn sec" onClick={() => addNode(null)} type="button">
            Add primary
          </button>
        </div>
      </div>

      {banner ? <div className="note">{banner}</div> : null}

      {actions.length ? (
        <section className="card" aria-labelledby="actions-head">
          <div className="ch">
            <div>
              <h3 id="actions-head">Actions attached</h3>
              <p>
                Actions run for every disposition on the path the agent selects, so one set on a
                parent applies to everything beneath it.
              </p>
            </div>
          </div>
          {actions.map((a) => {
            const reach = reachOf(a.node);
            return (
              <button
                className="libitem"
                key={a.node.id}
                type="button"
                style={{ cursor: 'pointer' }}
                onClick={() => setSelected(a.node.id)}
              >
                <Badge type={a.node.action!.type} />
                <span style={{ fontSize: 12.5, fontWeight: 500 }}>
                  {a.path.map((p) => p.name || 'Untitled').join(' › ')}
                </span>
                <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--hint)' }}>
                  {reach ? `also applies to ${reach} below it` : 'this outcome only'}
                </span>
              </button>
            );
          })}
        </section>
      ) : null}

      {clashes.length ? (
        <div className="issues" role="alert">
          <h4>
            {clashes.length} path{clashes.length > 1 ? 's' : ''} would run the same action twice
          </h4>
          <ul>
            {clashes.map((c, i) => (
              <li key={i}>
                <button type="button" onClick={() => setSelected(c.path[c.path.length - 1].id)}>
                  {c.path.map((p) => p.name || 'Untitled').join(' › ')} —{' '}
                  {c.type === 'callback' ? 'two callback windows' : 'two SMS sends'} (from{' '}
                  {c.sources.join(' and ')})
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.15fr) minmax(0,1fr)', gap: 18, alignItems: 'start' }}>
        <section className="card" aria-labelledby="tree-head">
          <div className="ch">
            <div>
              <h3 id="tree-head">Disposition tree</h3>
              <p>Up to {MAX_DEPTH} levels. Click a row to edit it.</p>
            </div>
          </div>
          <div style={{ maxHeight: '60vh', overflow: 'auto', margin: '-4px -6px' }} role="tree" aria-label="Dispositions">
            <TreeRows
              nodes={tree}
              depth={1}
              inherited={[]}
              selected={selected}
              collapsed={collapsed}
              onSelect={setSelected}
              onToggle={(nid) => setCollapsed((c) => ({ ...c, [nid]: !c[nid] }))}
            />
          </div>
          <button className="addlink" style={{ marginTop: 10 }} onClick={() => addNode(null)} type="button">
            + Add primary disposition
          </button>
        </section>

        <section className="card" style={{ position: 'sticky', top: 0 }} aria-labelledby="detail-head">
          {found ? (
            <NodeDetail
              found={found}
              onRename={rename}
              onCode={setCode}
              onAction={setAction}
              onEditAction={editAction}
              onToggleStatus={toggleStatus}
              onAddChild={addNode}
              onDelete={del}
            />
          ) : (
            <div className="stub">
              <h3 id="detail-head">No disposition selected</h3>
              <p>
                Pick a row on the left to edit its name, code and action — or add a primary
                disposition to start a new branch.
              </p>
            </div>
          )}
        </section>
      </div>

      {bulkOpen ? (
        <BulkUpload
          setId={id}
          onClose={() => setBulkOpen(false)}
          onMerged={(result, nextTree) => {
            setTree(nextTree);
            setCollapsed({});
            setBulkOpen(false);
            setBanner(
              `Merged. ${result.added} disposition${result.added === 1 ? '' : 's'} added, ` +
                `${result.matched} matched to existing branches` +
                (result.tooDeep
                  ? `, ${result.tooDeep} line${result.tooDeep === 1 ? '' : 's'} skipped for exceeding ${MAX_DEPTH} levels`
                  : '') +
                '.',
            );
          }}
        />
      ) : null}
    </div>
  );
}

function Badge({ type, inherited }: { type: DispositionActionType; inherited?: string }) {
  // Colours per action type. Border is written as one shorthand: mixing the `border`
  // shorthand with a `borderStyle` longhand in a React style object makes React clear
  // the other border longhands, which strips the colour and width off the badge.
  const palette =
    type === 'dnd'
      ? { bg: 'var(--dangerBg)', fg: 'var(--dangerText)', edge: 'var(--dangerBorder)' }
      : type === 'callback'
        ? { bg: 'var(--accentSoft)', fg: 'var(--accentDark)', edge: 'var(--accentBorder)' }
        : { bg: '#eef4fb', fg: '#2a5a8a', edge: '#d5e3f2' };

  const style: React.CSSProperties = {
    fontSize: 9.5,
    fontWeight: 700,
    letterSpacing: '.4px',
    borderRadius: 'var(--radiusPill)',
    padding: '2px 7px',
    flexShrink: 0,
    fontFamily: 'var(--fontMono)',
    background: palette.bg,
    color: palette.fg,
    // An inherited action reads as faded and dashed: shown, but not owned by this row.
    border: `1px ${inherited ? 'dashed' : 'solid'} ${palette.edge}`,
    opacity: inherited ? 0.5 : undefined,
  };

  return (
    <span style={style} title={inherited ? `Inherited from ${inherited}` : undefined}>
      {ACTIONS[type].badge}
      {inherited ? (
        <span style={{ position: 'absolute', left: -9999 }}> inherited from {inherited}</span>
      ) : null}
    </span>
  );
}

function TreeRows({
  nodes,
  depth,
  inherited,
  selected,
  collapsed,
  onSelect,
  onToggle,
}: {
  nodes: DispositionNode[];
  depth: number;
  inherited: Array<{ type: DispositionActionType; from: string }>;
  selected: string | null;
  collapsed: Record<string, boolean>;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
}) {
  return (
    <>
      {nodes.map((n) => {
        const open = !collapsed[n.id];
        const has = n.children.length > 0;
        const down = n.action ? [...inherited, { type: n.action.type, from: n.name }] : inherited;
        return (
          <div key={n.id} role="treeitem" aria-expanded={has ? open : undefined} aria-selected={selected === n.id}>
            <div
              className="trow"
              role="button"
              tabIndex={0}
              onClick={() => onSelect(n.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelect(n.id);
                }
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 9,
                padding: `7px 8px 7px ${(depth - 1) * 18 + 8}px`,
                borderRadius: 7,
                cursor: 'pointer',
                minHeight: 34,
                background: selected === n.id ? 'var(--accentSoft)' : undefined,
                boxShadow: selected === n.id ? 'inset 0 0 0 1px var(--accentBorder)' : undefined,
              }}
            >
              {has ? (
                <button
                  type="button"
                  aria-label={`${open ? 'Collapse' : 'Expand'} ${n.name || 'Untitled'}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggle(n.id);
                  }}
                  style={{
                    border: 'none',
                    background: 'none',
                    color: 'var(--hint)',
                    cursor: 'pointer',
                    fontSize: 10,
                    width: 16,
                    transform: open ? 'rotate(90deg)' : undefined,
                  }}
                >
                  ▸
                </button>
              ) : (
                <span style={{ width: 16 }} />
              )}
              <span
                style={{
                  fontSize: 13,
                  fontWeight: selected === n.id ? 600 : 500,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  color: n.name ? undefined : 'var(--placeholder)',
                  fontStyle: n.name ? undefined : 'italic',
                }}
              >
                {n.name || 'Untitled'}
              </span>
              <span style={{ fontFamily: 'var(--fontMono)', fontSize: 11, color: 'var(--hint)' }}>{n.code}</span>
              {inherited.map((i, x) => (
                <Badge key={x} type={i.type} inherited={i.from} />
              ))}
              {n.action ? <Badge type={n.action.type} /> : null}
              {n.status === 'Disabled' ? (
                <span
                  style={{
                    fontSize: 9.5,
                    fontWeight: 700,
                    fontFamily: 'var(--fontMono)',
                    borderRadius: 'var(--radiusPill)',
                    padding: '2px 7px',
                    background: 'var(--dangerBg)',
                    color: 'var(--dangerText)',
                    border: '1px solid var(--dangerBorder)',
                  }}
                >
                  DISABLED
                </span>
              ) : null}
              {has ? (
                <span
                  style={{
                    marginLeft: 'auto',
                    fontFamily: 'var(--fontMono)',
                    fontSize: 10.5,
                    color: 'var(--hint)',
                    background: '#f1f3f5',
                    borderRadius: 'var(--radiusPill)',
                    padding: '1px 7px',
                  }}
                >
                  {n.children.length}
                </span>
              ) : null}
            </div>
            {has && open ? (
              <div style={{ position: 'relative' }} role="group">
                <TreeRows
                  nodes={n.children}
                  depth={depth + 1}
                  inherited={down}
                  selected={selected}
                  collapsed={collapsed}
                  onSelect={onSelect}
                  onToggle={onToggle}
                />
              </div>
            ) : null}
          </div>
        );
      })}
    </>
  );
}

function NodeDetail({
  found,
  onRename,
  onCode,
  onAction,
  onEditAction,
  onToggleStatus,
  onAddChild,
  onDelete,
}: {
  found: { node: DispositionNode; depth: number; path: DispositionNode[] };
  onRename: (id: string, v: string) => void;
  onCode: (id: string, v: string) => void;
  onAction: (id: string, t: '' | DispositionActionType) => void;
  onEditAction: (id: string, patch: Record<string, string>) => void;
  onToggleStatus: (id: string) => void;
  onAddChild: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const { data: library } = useAsync<Record<string, Array<{ id: string; name: string }>>>(
    () => api.get('/meta/library'),
    [],
  );
  const node = found.node;
  const action = node.action;
  const atMaxDepth = found.depth >= MAX_DEPTH;
  const effective = effectiveActions(found.path);
  const inherited = inheritedActions(found.path, node);
  const reach = reachOf(node);
  const enabled = node.status === 'Enabled';

  return (
    <>
      <div className="ch">
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <h3 id="detail-head" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {node.name || 'Untitled'}
            </h3>
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              aria-label={enabled ? 'Enabled — agents can pick this' : 'Disabled — hidden from agents'}
              title={enabled ? 'Enabled · agents can pick this' : 'Disabled · hidden from agents'}
              onClick={() => onToggleStatus(node.id)}
              style={{
                width: 15,
                height: 15,
                borderRadius: '50%',
                border: '2px solid #fff',
                cursor: 'pointer',
                padding: 0,
                flexShrink: 0,
                background: enabled ? 'var(--success)' : 'var(--danger)',
                boxShadow: `0 0 0 3px ${enabled ? 'rgba(22,163,74,.2)' : 'rgba(220,38,38,.18)'}`,
              }}
            />
          </div>
          <p>
            Level {found.depth} · {found.path.map((p) => p.name || 'Untitled').join(' › ')}
          </p>
        </div>
      </div>

      {effective.length ? (
        <div
          style={{
            background: '#fbfcfd',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radiusControlLg)',
            padding: '12px 14px',
            marginBottom: 18,
          }}
        >
          <div
            style={{
              fontSize: 10.5,
              fontWeight: 700,
              letterSpacing: '.5px',
              textTransform: 'uppercase',
              color: 'var(--label)',
              marginBottom: 9,
            }}
          >
            Selecting this outcome runs
          </div>
          {effective.map((x, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '5px 0' }}>
              <Badge type={x.action.type} />
              <span style={{ fontSize: 12.5, lineHeight: 1.4 }}>{ACTIONS[x.action.type].desc}</span>
              <span
                style={{
                  marginLeft: 'auto',
                  fontSize: 11,
                  color: 'var(--hint)',
                  fontFamily: 'var(--fontMono)',
                  flexShrink: 0,
                }}
              >
                {x.node.id === node.id ? 'set here' : `from ${x.node.name || 'Untitled'}`}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="grid">
        <div className="f">
          <label htmlFor="dname">
            Name<span className="req">*</span>
          </label>
          <input id="dname" value={node.name} onChange={(e) => onRename(node.id, e.target.value)} placeholder="Name this disposition" />
        </div>
        <div className="f">
          <label htmlFor="dcode">
            Code<span className="req">*</span>
            {node.autoCode && node.code ? <span className="mtag">suggested</span> : null}
          </label>
          <input
            id="dcode"
            maxLength={3}
            value={node.code}
            placeholder={suggestCode(node.name) || 'ABC'}
            onChange={(e) => onCode(node.id, e.target.value)}
          />
          <div className="help">3 characters, unique within this set.</div>
        </div>

        <div className="f">
          <label htmlFor="daction">Custom option</label>
          <div className="selwrap">
            <select
              id="daction"
              value={action?.type ?? ''}
              onChange={(e) => onAction(node.id, e.target.value as '' | DispositionActionType)}
            >
              <option value="">None</option>
              {(Object.keys(ACTIONS) as DispositionActionType[]).map((k) => (
                <option key={k} value={k}>
                  {ACTIONS[k].label}
                </option>
              ))}
            </select>
          </div>
          <div className="help">
            {!action
              ? inherited.length
                ? 'Nothing set here, but this outcome still inherits the actions listed above.'
                : 'Records the outcome and nothing else.'
              : ACTIONS[action.type].desc}
          </div>
          {action && reach ? (
            <div
              style={{
                fontSize: 11.5,
                color: 'var(--accentDark)',
                background: 'var(--accentSoft)',
                border: '1px solid var(--accentBorder)',
                borderRadius: 7,
                padding: '7px 10px',
                marginTop: 7,
                lineHeight: 1.45,
              }}
            >
              Also applies to the {reach} disposition{reach > 1 ? 's' : ''} beneath this one.
            </div>
          ) : null}
        </div>

        {action?.type === 'dnd' ? (
          <div className="f full fade">
            <label htmlFor="dnd-list">
              DND<span className="req">*</span>
            </label>
            <div className="selwrap">
              <select
                id="dnd-list"
                value={(action as Extract<DispositionAction, { type: 'dnd' }>).dndList}
                onChange={(e) => onEditAction(node.id, { dndList: e.target.value })}
              >
                <option value="">Select an option</option>
                {(library?.dnd ?? []).map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="help">
              Leads dispositioned here are added to this list and never dialed again by any campaign.
            </div>
          </div>
        ) : null}

        {action?.type === 'callback' ? (
          <div className="f full fade">
            <label htmlFor="cb-window">Callback window (hours)</label>
            <input
              id="cb-window"
              type="number"
              value={(action as Extract<DispositionAction, { type: 'callback' }>).window}
              onChange={(e) => onEditAction(node.id, { window: e.target.value })}
            />
            <div className="help">
              The agent cannot submit this disposition without setting a callback time inside this
              window.
            </div>
          </div>
        ) : null}

        {action?.type === 'sms' ? (
          <div className="f full fade">
            <label htmlFor="sms-template">
              SMS template<span className="req">*</span>
            </label>
            <div className="selwrap">
              <select
                id="sms-template"
                value={(action as Extract<DispositionAction, { type: 'sms' }>).template}
                onChange={(e) => onEditAction(node.id, { template: e.target.value })}
              >
                {['', 'We tried to reach you', 'Payment link', 'Thanks for your time'].map((o) => (
                  <option key={o} value={o}>
                    {o || 'Select an option'}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ) : null}
      </div>

      <div style={{ display: 'flex', gap: 9, marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--divider)' }}>
        <button
          className="btn sec sm"
          disabled={atMaxDepth}
          title={atMaxDepth ? `${MAX_DEPTH} levels is the maximum` : undefined}
          onClick={() => onAddChild(node.id)}
          type="button"
        >
          {atMaxDepth ? 'Maximum depth reached' : '+ Add sub-disposition'}
        </button>
        <button className="btn sec sm danger" onClick={() => onDelete(node.id)} type="button">
          Delete{node.children.length ? ` (${reach} below)` : ''}
        </button>
      </div>
    </>
  );
}

function BulkUpload({
  setId,
  onClose,
  onMerged,
}: {
  setId: string;
  onClose: () => void;
  onMerged: (result: { added: number; matched: number; tooDeep: number }, tree: DispositionNode[]) => void;
}) {
  const [text, setText] = useState(
    'Connected [Con] > Interested [Int] > Ready to pay [Rdy]\n' +
      'Connected [Con] > Not interested [Not] | dnd\n' +
      'Not Connected [Ntc] > Busy [Bsy] | sms\n' +
      'Not Connected [Ntc] > Switched off [Swo]',
  );
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ added: number; matched: number; tooDeep: number; tree: DispositionNode[] }>(
        `/disposition-sets/${setId}/bulk`,
        { text },
      );
      onMerged(res, res.tree);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Upload the whole tree"
      sub="One file for all five levels instead of a separate upload per level. Each line is a full path — the levels are created and matched for you."
      onClose={onClose}
      footer={
        <>
          <button className="btn sec" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="btn pri" onClick={run} disabled={busy} type="button">
            {busy ? 'Merging…' : 'Preview and merge'}
          </button>
        </>
      }
    >
      <div className="note" style={{ marginBottom: 14 }}>
        <b>Format.</b> One path per line, levels separated by <b>&gt;</b>. Add a code in brackets, and
        an action after a pipe: <b>dnd</b>, <b>callback</b> or <b>sms</b>.
      </div>
      <div className="f">
        <label htmlFor="bulk">Paste or drop a CSV</label>
        <textarea
          id="bulk"
          value={text}
          spellCheck={false}
          onChange={(e) => setText(e.target.value)}
          style={{ minHeight: 150, fontFamily: 'var(--fontMono)', fontSize: 12.5, lineHeight: 1.75, resize: 'vertical' }}
        />
        <div className="help">
          Existing branches are matched by name, so re-uploading only adds what is missing.
        </div>
      </div>
    </Modal>
  );
}
