# Acefone Cloud Dialer — Backend & Data Model Rewrite (POC)

An agent-centric, multi-queue **blended dialer** proof-of-concept: backend + database layer
only. The existing product UI is untouched; the two pages in `public/` exist purely to make
the routing rules visible.

The whole thing is organised around one rule:

> **An agent sits above queues.** They can be on many inbound queues *and* many outbound
> campaigns at once. When they become free, **every inbound queue they are on is checked
> first**. Outbound is only consulted once all of them are empty. Inbound and outbound
> priority are two separate scales and are never compared against each other.

---

## 1. Running it locally

### Prerequisites
- Node.js 20+
- MongoDB and Redis (a `docker-compose.yml` is included for both)

```bash
git clone <this repo> && cd agent-panel
npm install
cp .env.example .env

# MongoDB on :27017 and Redis on :6379 (Redis is started with `--notify-keyspace-events Ex`,
# which the wrap-up countdown needs)
npm run infra:up

npm run seed      # 6 agents, 3 inbound queues, 3 outbound campaigns, 180 leads, settings
npm run dev       # http://localhost:4000
```

Then open **two browser tabs**:

| View | URL | What it shows |
|---|---|---|
| Agent desktop | http://localhost:4000/agent.html | status, wrap-up countdown, the two ranked queue lists, active call |
| Supervisor | http://localhost:4000/supervisor.html | live queue depths, pacing stats, wrap-up setting, routing decision feed |

The call simulator starts automatically (`SIMULATOR_ENABLED=true`), so calls begin arriving
and campaigns begin pacing straight away. Turn it off with the **Simulator: ON/OFF** button
on the supervisor view when you want to drive everything by hand.

### Already-working commands

```bash
npm test          # 53 tests: routing engine, pacing strategies, Redis lock, HTTP wiring
npm run demo:engine   # walks the worked examples below — no Mongo/Redis/HTTP needed
npm run typecheck
npm run build && npm start
```

`npm run demo:engine` is the fastest way to see the algorithm: it prints the engine's own
decision trace for every scenario in section 3, with no infrastructure at all.

### If you don't want Docker
Point `MONGO_URL` / `REDIS_URL` in `.env` at any Mongo 6+/Redis 7 you already have. Redis
must have key-expiry notifications on; the app tries `CONFIG SET notify-keyspace-events Ex`
at boot and falls back to a 1-second sweeper if that is refused, so the wrap-up timer keeps
working either way.

---

## 2. The assignment algorithm in plain English

Every assignment decision is made **for one agent at a time**, in this fixed order. The
order *is* the design — steps never blend into a weighted score.

### Step 1 — Concurrency + state gate
Before anything else:

1. **Does the agent hold a call?** If `agent.currentCallId` is set, the agent is not a
   candidate. Full stop. No queue priority, no campaign urgency, no supervisor override
   changes this. This is checked *before* status, so even a stale `available` status
   cannot leak a second call through.
2. **Is the agent `available`?** `on_call`, `wrap_up`, `break` and `offline` are all
   equally disqualifying. Wrap-up is not special-cased — as far as the engine is concerned
   it is just another non-available state.

If the gate fails, the waiting call or lead **stays exactly where it is** and is
re-evaluated on the next tick. Nothing is ever force-assigned, and nothing is dropped.

### Step 2 — Inbound precedence
Collect **every inbound queue this agent is assigned to** and keep the ones that
(a) the agent has the required skill for at the required proficiency, and
(b) have at least one call in `waiting`.

**If that list is non-empty, the answer is inbound.** Outbound is not loaded, not scored,
not compared. The engine's trace literally says `outbound not evaluated`.

### Step 3a — Within the inbound scale
Among those inbound queues:
1. lowest `priority` number wins (inbound priorities are only ever compared to other
   inbound priorities);
2. ties are broken by the **longest-waiting call**;
3. within the winning queue, the longest-waiting call is taken.

### Step 3b — Within the outbound scale
Reached **only** when step 2 found nothing. Collect the agent's outbound queues that they
are skilled for and whose campaign has lines up (per its pacing strategy), then:
1. lowest `priority` number wins — on the **outbound scale**, which restarts at 1 and has
   no relationship to the inbound numbers;
2. ties are broken by the agent's own `rankOverride` for that assignment (lower wins; an
   unset override ranks last, so an explicitly-ranked campaign beats an unranked one);
3. still tied → earliest campaign `dueAt`.

`rankOverride` is a **tie-break only**. It cannot promote a campaign past a
higher-priority one, and it can never pull outbound ahead of inbound.

### Committing the decision
The pure engine produces a decision; the service layer commits it inside that agent's
**Redis lock**:

```
acquire lock dialer:lock:agent:<id>
  re-read the agent from Mongo and re-apply the gate  (state may have moved)
  atomically claim the queue item: findOneAndUpdate({_id, status:'waiting'} -> 'assigned')
  create the callSession
  set agent.currentCallId + status = on_call
release lock
```

Two concurrent triggers (an inbound arrival and a campaign tick, say) therefore cannot both
hand a call to the same agent. If the re-check fails, the decision is discarded, logged as
`NOT committed`, and the work stays queued.

### What triggers a pass
`inbound_call_arrival`, `agent_state_change` (login, ready, end-of-wrap-up, reject),
`campaign_tick`, `manual_dial`, and a periodic `ASSIGNMENT_TICK_MS` sweep that catches
anything the event-driven triggers missed.

---

## 3. Worked examples

Run `npm run demo:engine` to see these print with the engine's real trace.

### 3.1 An agent on 2 inbound + 2 outbound queues

**Rahul Verma** is assigned to:

| Direction | Queue | Priority (own scale) | Required skill |
|---|---|---|---|
| inbound | General Support | **2** | support ≥ 2 |
| inbound | Billing | **3** | billing ≥ 2 |
| outbound | Collections (predictive) | **1** | billing ≥ 2 |
| outbound | Winback (progressive) | **2** | sales ≥ 2 |

Note that Collections has outbound priority **1** — numerically "better" than both of
Rahul's inbound queues. It is irrelevant: they are different scales.

**Case A — calls waiting in both inbound queues.**
Gate passes. Inbound queues checked: both have work. General Support (priority 2) beats
Billing (priority 3) even though the Billing call has been waiting 200s and the General
Support call only 20s — priority is compared first, wait time is only the tie-break.
→ **General Support**.

**Case B — only Billing has a call.**
Inbound still wins. Billing is Rahul's *worst* inbound queue (priority 3) and the call is
3 seconds old, while Collections (outbound priority 1) has lines up and ready. Inbound
precedence is absolute, so outbound is never even looked at.
→ **Billing**.

**Case C — both inbound queues empty.**
Only now does the engine load outbound. Collections (outbound priority 1) beats Winback
(outbound priority 2).
→ **Collections**, in predictive mode.

**Case D — outbound tie-break.**
If Collections and Winback were *both* outbound priority 1, the tie falls to Rahul's own
`rankOverride`: with `Collections: 5` and `Winback: 1`, Winback wins. With no overrides at
all, the campaign with the earlier `dueAt` wins. (With the priorities *untied*, those same
overrides change nothing — Collections still wins on priority.)

### 3.2 A call arrives while the agent is mid-wrap-up

Wrap-up duration is 30s (`settings.wrapUpDurationSeconds`).

```
t+0s   Rahul ends a call.
       → currentCallId cleared, status = wrap_up,
         wrapUpDeadline = t+30s,
         Redis key dialer:wrapup:<agentId> set with EX 30
       → the agent desktop shows a live countdown; supervisor sees wrap_up

t+10s  A General Support call arrives. The engine runs on the arrival.
       → gate: agent_status_wrap_up -> not a candidate
       → the call is NOT assigned, NOT dropped: it stays 'waiting' in General Support
       → a routingDecisionLog row records exactly that, and it appears in the
         supervisor feed as a red "NOT committed" row

t+11s  Another agent is available? Then they get it on this same tick.
       Nobody available? It keeps waiting and is re-evaluated every tick.

t+30s  The Redis key expires. The keyspace-expiry listener fires
       (a 1s sweeper is the safety net) and flips Rahul to available.
       → that transition is itself an 'agent_state_change' trigger
       → the engine re-runs for Rahul and hands him the call that has now
         been waiting 20 seconds
```

If Rahul had clicked **"I'm ready"** at t+15s instead, `endWrapUp` would have deleted the
Redis key, set him to available, and fired the same trigger — he'd have taken the call 15
seconds earlier. Either path lands in the same place; the timer just guarantees it happens
without the agent (or a connected browser) doing anything.

**Why Redis and not a `setTimeout`:** the countdown lives in a TTL key on the server, so it
survives a browser refresh, an agent closing their laptop, and — via the sweeper reading
`wrapUpDeadline` from Mongo — a backend restart.

---

## 4. Swapping in a new dialing mode

A dialing mode is a **pacing strategy** and nothing else. It answers one question: *how
many lines should this campaign put up right now, and when is it next due?* It never picks
agents — everything downstream of it is identical for all six modes, and only runs after
the inbound-precedence check has cleared.

```ts
// src/pacing/strategy.ts
export interface PacingStrategy {
  readonly mode: DialingMode;
  readonly requiresAgentConfirmation: boolean;  // preview + manual
  readonly autoDials: boolean;                  // false for preview + manual
  computeDialPlan(input: PacingInput): PacingDecision;
}
```

To add one — say a "burst" mode that puts up 10 lines per available agent:

```ts
// src/pacing/burst.ts
import { PacingStrategy, clampLines } from './strategy';

export const burstStrategy: PacingStrategy = {
  mode: 'burst' as any,          // add 'burst' to DialingMode in src/routing/types.ts
  requiresAgentConfirmation: false,
  autoDials: true,
  computeDialPlan({ config, stats, now }) {
    const ratio = Number(config.ratio ?? 10);
    return {
      mode: 'burst' as any,
      linesToDial: clampLines(stats.availableAgents * ratio - stats.activeDials, stats),
      nextDueAt: new Date(now.getTime() + Number(config.intervalMs ?? 3000)),
      effectiveRatio: ratio,
      reason: `burst: ${ratio}:1`,
    };
  },
};
```

Then register it and you're done:

```ts
// src/pacing/registry.ts
import { burstStrategy } from './burst';
registerPacingStrategy(burstStrategy);
```

Three steps total:
1. add the mode name to the `DialingMode` union (`src/routing/types.ts`) and to the
   `dialingMode` enum on the campaign schema (`src/models/index.ts`);
2. write the strategy;
3. `registerPacingStrategy(...)`.

**Nothing in `src/routing/*` changes.** The engine consults
`strategy.requiresAgentConfirmation` to decide whether to *offer* the lead or *connect* it,
and that is the only place mode-specific behaviour survives past the pacing layer.
`GET /api/admin/dialing-modes` is populated straight from the registry, so the supervisor
view picks up the new mode with no further work.

The six shipped modes:

| Mode | Lines put up | Auto-dials | Agent confirms first |
|---|---|---|---|
| `predictive` | `availableAgents × ratio`, ratio adapted by abandon-rate feedback | yes | no |
| `progressive` | strict 1:1 with available agents | yes | no |
| `preview` | 1 per available agent | no | **yes** |
| `power` | fixed `N:1` | yes | no |
| `ratio` | fixed `N:1` (separate strategy so it can diverge) | yes | no |
| `manual` | 0 — a line exists only when an agent asks | no | **yes** |

---

## 5. Data model

MongoDB via Mongoose. Embedded where the data is always read with its parent, referenced
where it is queried and updated on its own.

| Collection | Shape | Why |
|---|---|---|
| `settings` | `{ key, value }` | `wrapUpDurationSeconds` lives here, never as a constant. Key/value so per-queue overrides can be added later without a migration. |
| `skills` | `{ name }` | Referenced by queues and agents; independently listed. |
| `agents` | `{ name, extension, status, currentCallId, wrapUpStartedAt, wrapUpDeadline, lastAssignedAt, skills[], assignedQueues[] }` | `skills` and `assignedQueues` are **embedded** — never read without the agent. `currentCallId` and the wrap-up fields are **on the agent document** because the gate reads them on every tick. `assignedQueues[].type` is denormalised so the gate can split inbound/outbound without loading queues. |
| `queues` | `{ name, type, priority, requiredSkillId, minProficiency, campaignId }` | One `priority` field, **scoped within `type`**. Index is `{type, priority}` — the two-scales rule expressed in the schema. |
| `campaigns` | `{ name, queueId, dialingMode, pacingConfig, active, nextDueAt, lastPacingDecision }` | `pacingConfig` is `Mixed`: each strategy owns its own shape. Predictive writes its adapted ratio back into it. |
| `leads` | `{ campaignId, phone, name, status, attemptCount, dncFlag, lastAttemptAt }` | Independently queried and updated; `dncFlag` is stored but **not enforced** (compliance is out of scope). |
| `callQueueItems` | `{ queueId, direction, callerNumber, leadId, campaignId, queuedAt, matchedSkillId, status, offeredToAgentId, assignedAgentId }` | The unit of work for both directions. Index `{status, queueId, queuedAt}` is the engine's hot read. The atomic `waiting → assigned` flip is what makes double-assignment impossible. |
| `callSessions` | `{ direction, queueId, agentId, campaignId, leadId, queueItemId, dialingMode, callerNumber, state, startedAt, endedAt, disposition }` | `state` is `offering \| connected \| ended`. An `offering` session still occupies the agent, so preview/manual offers are covered by the one-call-at-a-time rule for free. |
| `routingDecisionLogs` | `{ triggerType, candidateType, evaluatedAgents[], chosenAgentId, chosenQueueId, chosenCallId, reason, createdAt }` | The audit trail. `evaluatedAgents` is embedded (only ever read with its decision) and carries the engine's full trace, including *why an agent was skipped*. |

---

## 6. Project layout

```
src/
  routing/          THE ENGINE — pure, no mongoose/redis/express/socket.io imports
    types.ts        plain snapshot types
    engine.ts       checkAgentGate / collectInbound / collectOutbound / evaluateAgent / runAssignmentTick
  pacing/
    strategy.ts     the PacingStrategy interface
    strategies.ts   predictive, progressive, preview, power, ratio, manual
    registry.ts     register/get — the extension point
  models/index.ts   all Mongoose schemas
  services/
    assignmentService.ts  snapshots -> engine -> locked commit -> decision log
    agentService.ts       the state machine (login/status/accept/reject/end-call/wrap-up)
    wrapUpService.ts      Redis TTL expiry listener + 1s sweeper + countdown ticks
    lock.ts               per-agent Redis lock (compare-and-delete release)
    queueDepth.ts         Redis queue-depth counters
    settingsService.ts    wrapUpDurationSeconds
  simulator/index.ts      synthetic inbound arrivals, campaign pacing loop, call ageing
  api/                    Express routes (agents / admin / simulate)
  ws/bus.ts               socket.io fan-out
  seed.ts                 the seed script
public/                   the two POC views
tests/                    engine, pacing, lock, http
scripts/demo-engine.ts    infra-free walkthrough
```

**The engine is deliberately dependency-free.** `src/routing/` imports nothing but its own
types, which is why the 46 engine + pacing tests run with no database, no Redis and no
network.

---

## 7. API

### Agent-facing
| Method | Path | Body | Notes |
|---|---|---|---|
| `GET` | `/api/agents` | | roster + live state |
| `GET` | `/api/agents/:id` | | state + active call |
| `GET` | `/api/agents/:id/my-queues` | | **two separate ranked lists**: `inbound[]` and `outbound[]`, each sorted on its own scale |
| `POST` | `/api/agents/:id/login` | | offline → available |
| `POST` | `/api/agents/:id/status` | `{status}` | `available` / `break` / `offline` only — `on_call` and `wrap_up` are owned by the call lifecycle. Refused while a call is held. |
| `POST` | `/api/agents/:id/accept` | | accept a preview/manual offer |
| `POST` | `/api/agents/:id/reject` | `{reason?}` | lead goes back to `waiting`; agent returns to available with **no** wrap-up |
| `POST` | `/api/agents/:id/end-call` | `{disposition?}` | → `wrap_up`, timer armed |
| `POST` | `/api/agents/:id/end-wrap-up` | | the "I'm ready" button |
| `POST` | `/api/agents/:id/manual-dial` | `{campaignId}` | manual mode: put up exactly one line |

### Admin / supervisor
| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/admin/settings` | |
| `PUT` | `/api/admin/settings/wrap-up` | `{seconds}` |
| `GET` | `/api/admin/queues` | depths, split by direction, each sorted on its own scale |
| `GET` | `/api/admin/campaigns` | dialing mode + last pacing decision |
| `GET` | `/api/admin/agents` | |
| `GET` | `/api/admin/decisions?limit=` | the routing decision feed |
| `GET` | `/api/admin/dialing-modes` | straight from the strategy registry |
| `PUT` | `/api/admin/agents/:id/queues` | reassign queues live, to demo precedence |

### Simulator
| Method | Path | Body |
|---|---|---|
| `POST` | `/simulate/inbound-call` | `{queueId, callerNumber?}` |
| `POST` | `/simulate/campaign-tick` | `{campaignId, lines?}` |
| `POST` | `/simulate/assignment-tick` | — force a pass and get every decision + trace back |
| `POST` | `/simulate/toggle` | `{enabled}` |
| `POST` | `/simulate/inbound-rate` | `{queueId, callsPerMinute}` |
| `GET` | `/simulate/state` | |

### WebSocket (socket.io)
`agent:state` · `wrapup:tick` · `routing:decision` · `queue:depth` · `call:queued` ·
`call:offered` · `call:assigned` · `call:accepted` · `call:rejected` · `call:ended` ·
`campaign:pacing` · `settings:updated` · `simulator:state`

---

## 8. Demo script — proving the three rules

With `npm run seed && npm run dev` and both tabs open:

**One call at a time.** Turn the simulator off. Inject a call into General Support from the
supervisor view. Watch it land on an agent — their status flips to `on_call` and every
status button on their desktop greys out. Inject a second call: it sits in the queue and
the decision feed shows a red `agent_has_active_call` row for that agent. It is not
force-assigned and not dropped.

**Inbound beats outbound.** Pick Rahul Verma (2 inbound + 2 outbound). With all inbound
queues empty, tick the Collections campaign — he takes an outbound line. End the call, let
wrap-up finish, then inject a Billing call (inbound priority **3**, the worst one he has)
*and* tick Collections (outbound priority **1**) in the same breath. He takes Billing. The
trace says `outbound not evaluated`.

**Wrap-up gating.** Set the wrap-up duration to 20s on the supervisor view. End a call. The
agent desktop shows the countdown. Inject a call into one of that agent's queues: the
decision feed shows `agent_status_wrap_up — work stays queued`, repeated each tick. When the
countdown hits zero the agent flips to available on their own and the next tick hands them
the waiting call. Do it again and hit **"I'm ready"** halfway through — same outcome, sooner.

---

## 9. Explicitly out of scope for this POC

Not built, deliberately:

- **Real SIP/telephony signalling** — no Asterisk, FreeSWITCH or OpenSIPS integration. The
  call simulator stands in for all of it. Every place a real stack would plug in
  (`injectInboundCall`, the campaign line-placement loop, `ageCalls`) is isolated in
  `src/simulator/`.
- **DNC / DLT / TRAI compliance checks** — `leads.dncFlag` exists and the simulator skips
  flagged leads, but there is no scrubbing, no registry lookup, no consent handling and no
  time-of-day restriction.
- **CRM integrations** — no screen-pop, no contact sync, no disposition write-back.
- **Auth / multi-tenancy** — every endpoint is open, there are no tokens, no roles, and no
  tenant scoping anywhere in the schema. The agent desktop picks an agent from a dropdown.
- **Production-grade error handling / horizontal scaling** — single-process. The per-agent
  Redis lock is the one concurrency primitive that *is* built for multi-process, but the
  assignment tick, the wrap-up sweeper and the simulator all assume one instance. There is
  no retry/backoff, no dead-letter handling, no graceful degradation if Redis disappears.
- **Per-queue wrap-up overrides** — one global `wrapUpDurationSeconds`. The `settings`
  collection is key/value so this can be extended without a migration, but it is not built.

## 10. Assumptions made

Stated rather than asked, since none of these block a correct implementation:

1. **Multi-agent selection.** The spec is agent-centric ("when an agent becomes eligible"),
   so a tick iterates agents and asks each one what it should do. When several agents
   compete for one call, the **longest-idle agent** (`lastAssignedAt`) picks first. A
   single tick claims each waiting call at most once.
2. **Inbound calls auto-connect**; only `preview` and `manual` create an *offer* the agent
   must accept or reject. The accept/reject endpoints work on any offering session.
3. **An outstanding offer occupies the agent** — it is a `callSession` in state `offering`,
   so `currentCallId` is set and the one-call-at-a-time rule covers offers with no extra
   machinery. Rejecting requeues the lead and returns the agent to available with no
   wrap-up.
4. **A rejected or unanswered lead goes back to `waiting`** rather than being failed. Retry
   policy and attempt caps are not modelled beyond `attemptCount`.
5. **Skills gate queue eligibility**, matching `requiredSkillId` at `minProficiency`. A
   queue with no `requiredSkillId` is open to everyone.
6. **`rankOverride` is an outbound tie-break only.** It cannot beat a better outbound
   priority and never crosses into the inbound scale. An unset override ranks last.
7. **Predictive's adapted ratio persists** in `campaign.pacingConfig.currentRatio`, so the
   feedback loop survives a restart.
8. **Wrap-up always follows a completed call**, including outbound ones, and is skipped for
   rejected offers.
9. **Going on break out of wrap-up is allowed** and disarms the timer.
