# Dialer — Campaign Configuration Workspace

A React front end and backend for the **campaign configuration layer** of the CCaaS dialer,
replacing the existing PHP form-based UI. It ships on three platforms (Smartflo, Acefone IN,
Acefone UK) from one codebase, differing only by brand tokens.

```bash
npm install
npm run build -w @dialer/shared   # the client and server both import this
npm run dev                       # API on :4100, UI on :5273
```

Open <http://localhost:5273>. The API seeds itself on first run, so there is nothing to
migrate or import. Add `?brand=acefone-uk` to see the platform token swap.

| Command | What it does |
|---|---|
| `npm test` | 124 tests: 82 on the shared rules, 42 on the API |
| `npm run e2e` | 46 browser checks driving the real UI against the real API |
| `npm run typecheck` | all three packages |
| `npm run build` | shared → server → client |

---

## 1. The one architectural rule

Objects split on a single question: **does this exist independently of any campaign?**

| Tier | Objects | Rule |
|---|---|---|
| **Campaign-owned** | Inbound Queues | Created with a campaign, never shared, cascade-deleted with it. Not in the nav. |
| **Shared library** | Lead Lists, Dispositions, Surveys, Agent Scripts, Transfer Directory, Pause Codes, Skill Lists, DND | Reusable across campaigns. Live in the nav under four groups. |

The library groups use these exact words in **both** the nav and the campaign form, so a
user who learns one has learned the other:

- **Lead data** — Lead Lists
- **Call outcomes** — Dispositions, Surveys
- **Agent setup** — Agent Scripts, Transfer Directory, Pause Codes, Skill Lists
- **Compliance** — DND

Every library object ships with a **seeded default**, and every library dropdown in a
campaign carries **`+ New`**. Together those two facts mean a new account can publish a
working campaign without ever visiting the library. That is the central usability goal;
everything else is downstream of it.

---

## 2. Where the code lives

```
packages/
  shared/    the field model, the rules, and the validation — imported by BOTH sides
  server/    Express over a repository layer
  client/    React + Vite
e2e/         browser tests that drive the real UI against the real API
```

### `@dialer/shared` is the point of the whole structure

The brief says *"server-side validation must mirror the client exactly."* Rather than
write it twice and hope, both sides import the same functions:

```ts
// the client, for live feedback while typing
const issues = campaignIssues(values, { leadLists });

// the server, as the authoritative gate
export function assertPublishable(db, campaignId, values) {
  const issues = campaignIssues(values, validationContext(db, campaignId, values));
  if (issues.length) throw unprocessable(toValidationErrors(issues));
}
```

They cannot drift, because they are the same function. What the server adds is the
account-wide knowledge the client does not have — which DIDs and transfer codes other
campaigns already claim — passed in as context.

| File | Holds |
|---|---|
| `campaign-fields.ts` | 11 sections, 59 fields, 4 phases, 5 pacing strategies, 4 templates |
| `queue-fields.ts` | the 37 inbound queue fields |
| `validation.ts` | required-field rules, DID collisions, transfer-code clashes |
| `dispositions.ts` | the tree engine: cascade, conflicts, codes, bulk parsing |
| `lead-lists.ts` | column rules, masking, sample-CSV generation |
| `essentials.ts` | essentials mode, dirty tracking, section summaries |
| `policy.ts` | the six open product decisions, as named switches |
| `tokens.ts` | design tokens and the three brand ramps |

### Library references are stored as ids

The brief names these fields `dispositionSetId`, `surveyId`, `pauseCodeSetId` and so on.
The **values are ids**, as it specifies — but the field *names* keep the prototype's
spelling, because those names are the form's identity and appear throughout the templates,
defaults and seed data. The mapping is:

| Field id | Points at |
|---|---|
| `dispositionList` | a disposition set |
| `csatSurvey` | a survey |
| `pauseCodeList` | a pause code set |
| `skillList` | a skill list |
| `dndList` | a DND list |
| `agentScript` | an agent script |
| `quickTransfer` | a transfer directory |
| `leadLists[]` | lead lists (max 3) |

Templates are authored by hand and so name library objects by **name**; the server
resolves those to ids when it creates the campaign, which is the only place a name is ever
accepted.

**Adding a setting is a data change in `campaign-fields.ts` and nothing else.** No new JSX.
A test asserts the inventory counts so an accidental deletion cannot pass silently.

---

## 3. Two things the prototype did that production would have broken

**Dependency detection by reading function source.** The prototype worked out which
toggle revealed which field with `String(f.when).includes(tog.id)`. That reads the literal
text of the predicate — and a minified production build renames `v.enableCsat` to
something like `n.a`, so every dependency silently disappears and the dense-toggle layout
and essentials mode both quietly break. Fields now declare `dependsOn: ['enableCsat']`
explicitly, and a test asserts every conditional field has one.

**Re-rendering the focused input.** The prototype replaced `innerHTML` on every keystroke,
which blew away the focused element, so it hand-patched sibling DOM nodes on `input` and
re-rendered on `blur`. In React the correct behaviour is the default: a controlled input
with a stable identity is updated in place and keeps its caret. The rule that matters is
therefore *never remount* — no `key` derived from a value the user is typing, no
conditional wrapper that changes element identity. Where a component syncs to an external
value (`EditableTitle`) it is uncontrolled with `defaultValue` and commits on blur.

---

## 4. The campaign form

59 fields across 11 sections, grouped into 4 lifecycle phases, numbered continuously 1–11.

**Setup** (30) · **During the call** (9) · **After the call** (18) · **Inbound** (2)

### What blocks publish

- **12 always**: campaign name, ≥1 lead list, caller ID, disposition set, dial method,
  wrap-up time, after-call-work, agent connection method, agent group,
  connect-agent-through, ring timeout, dial status. Four of those ship with a sensible
  default, so a fresh campaign actually opens with 8 open.
- **Plus pacing, by dial method** — Progressive needs nothing; Predictive needs a pacing
  ratio and a max abandon rate (TRAI ceiling 3%); Power needs lines per agent; Ratio needs
  a dial ratio; Preview needs a preview timeout.
- **7 conditionally**, each gated by a toggle: CSAT survey, screen pop-up URL, webform URL,
  skill list, pause code set, manual dial caller ID, ≥1 inbound queue.

A field hidden by a failing `when` predicate is excluded from validation entirely — you are
never blocked by something you cannot see.

### Essentials vs All settings

The default view shows only fields that **block publish**, **have been changed**, or **gate
something essential**. Sections with nothing essential are hidden rather than shown empty.
On a seeded campaign that is roughly 19 of 55.

`isEssential` promotes a toggle when something it reveals is itself essential — so
*Enforce agent pause code* is noise until you turn it on, at which point it and the pause
code set it demands both appear.

### One issue surface

The footer carries the count and is clickable. Rail dots mark location. The full list
appears **only** when the user clicks *Fix n to publish*. The publish button is never
disabled, because a disabled button cannot explain itself.

### Dirty tracking

Per field against the last published values, surfaced four ways: a dot on the field, a
count on the section, a count on the phase, and a total in the footer. Changes to a
currently-hidden field are not counted.

---

## 5. Inbound queues

37 fields, owned by exactly one campaign and reached only from inside it.

**Queue fields deliberately do not inherit from the campaign.** Inbound music-on-hold,
inbound ring timeout and inbound SMS templates are genuinely different values from their
outbound counterparts. Where a field is twinned, the UI shows the campaign's value beside
it as a read-only reference (`Campaign uses Corporate loop for its outbound leg`) — it is a
reference, never a copy, and nothing is ever written from one to the other.

**A DID may point at only one queue account-wide.** Enforced on create, on patch, and at
publish; the error names the queue that already claims it, on this campaign or another.
Numbers compare with spacing and punctuation stripped, so `1800 209 5000` and
`18002095000` collide.

**Tiered fallback, not per-agent priority.** Agents sit in one of three tiers; calls try
tier 1, then fall to tier 2. That is the decision a supervisor actually makes.

---

## 6. Dispositions

A tree, maximum 5 levels. Each node carries a name, a 3-character code, a status, and
optionally an action (`dnd`, `callback` or `sms`).

**Actions cascade along the path, not just the leaf.** An action on a level-2 node applies
to everything beneath it. The UI therefore:

- shows inherited actions on descendant rows as **faded, dashed** badges
- shows, on any selected node, the **full effective action list with its source**
  (`set here` / `from Connected`)
- reports reach when you set an action on a parent (`Also applies to the 4 dispositions
  beneath this one`)
- flags paths that would run **two callbacks or two SMS** as conflicts

Duplicate DND is **not** flagged — adding a lead to the same list twice is the same
outcome, so it is idempotent rather than a mistake.

**Codes** are 3 characters, auto-suggested from the name (first letter of each word plus
that word's consonants, concatenated, take 3: *Not Connected* → `Ntc`). Collisions resolve
`Int` → `In2` → `In3`, never growing past 3.

**Bulk upload** takes one file for the whole tree, one path per line:

```
Connected [Con] > Interested [Int] > Ready to pay
Connected > Not interested | dnd
```

Existing branches match by name (case-insensitively), so re-uploading only adds what is
missing. Lines exceeding 5 levels are rejected with a count rather than truncated.

---

## 7. Lead lists

Shared library objects, attachable to at most 3 campaigns' worth of dialing each — the cap
is a rule about how many a campaign may dial, not a statement about ownership.

**Schema**: 6 fixed columns + up to 34 custom = 40.

`phone` is the number that gets dialed and `altphone` is a second real number, so **neither
can ever be marked sensitive** — the server strips that flag even if a client sends it.

- `sensitive` → masked in the agent panel
- `hidden` → excluded from the agent panel **and** from the generated sample CSV

The sample CSV is generated from the schema on request, so the template can never drift
from the columns. Dropping a populated column warns with the record count, and the server
deletes that key from every record rather than leaving orphans.

**Upload** takes a duplicate mode (`skip` / `overwrite` / `clone`) and a dedupe scope
(`this list` / `all lists`). Overwrite only rewrites rows in *this* list — a row in another
list is not ours to edit, so it is skipped and reported.

---

## 8. Surveys

Two types, chosen at creation and **immutable** thereafter: converting would discard every
type-specific setting, so no conversion path exists in the UI *or* the API (`PATCH` with a
different `type` is a 400).

- **voice** — digit timeout, recording entries (`recording` / `dtmf` / `destination`), plus
  invalid-input and timeout fallbacks with their own retry counts
- **web** — questions with a response type of Dropdown, Checkboxes (multiple), Short
  answer, Date or Date/Time. Options are required, minimum two, for the first two types
  only; the others explain themselves instead of offering an empty options list

---

## 9. API

```
GET    /api/campaigns                      list, with server-side search
POST   /api/campaigns                      create (accepts templateId)
GET    /api/campaigns/:id                  full config incl. owned queues
PATCH  /api/campaigns/:id                  draft save
POST   /api/campaigns/:id/publish          422 with field-keyed errors
POST   /api/campaigns/:id/duplicate
DELETE /api/campaigns/:id                  cascades, and names the queues that went
POST   /api/campaigns/:id/queues           409 naming the clashing queue on a DID collision
PATCH  /api/campaigns/:id/queues/:qid
DELETE /api/campaigns/:id/queues/:qid      returns orphanedDids

GET    /api/lead-lists                     includes usedByCampaigns
GET    /api/lead-lists/:id/schema
PATCH  /api/lead-lists/:id/schema          rejects >34 custom columns
GET    /api/lead-lists/:id/records         paginated, server-side search
POST   /api/lead-lists/:id/records/upload  duplicateMode + dedupeScope
GET    /api/lead-lists/:id/sample.csv      generated from the schema

GET    /api/disposition-sets/:id           full tree + conflict detail
PUT    /api/disposition-sets/:id/tree      validates depth <=5 and unique codes
POST   /api/disposition-sets/:id/bulk      returns {added, matched, tooDeep, errors}

GET/POST/PATCH/DELETE  /api/surveys /dnd-lists /transfer-directories
                       /pause-code-sets /skill-lists /agent-scripts
GET    /api/meta/library                   every dropdown's options in one call
```

**Usage counts** ship with each list payload, computed in a single pass over the campaigns
— never one query per row. A DND list referenced only by a disposition action still counts
as used by the campaigns that use that disposition set.

---

## 10. Migration

**Phase 1 (this build).** Inbound queues are stored as **standalone records carrying a
`campaignId`**, exactly as the legacy schema holds them. `Store.campaignWithQueues()`
assembles them into campaign-owned children on the way out and `writeCampaignValues()`
splits them apart on the way in. The user experiences the collapsed model from day one,
with zero data migration.

**Phase 2.** Fold queues into the campaign record. Because the seam is one file, that is a
change to `packages/server/src/db/store.ts` alone.

The boundary is real, not aspirational: **no React component knows a queue is stored
separately**, and an API test asserts the assembled payload carries no `campaignId`.

### Before writing the real migration

The prototype assumes lead lists are shared (many-to-one) and queues are exclusive
(one-to-many). Verify both against production first:

```sql
-- lead lists attached to more than one campaign
SELECT lead_list_id, COUNT(DISTINCT campaign_id) c
FROM campaign_lead_lists GROUP BY 1 HAVING c > 1;

-- inbound queues referenced by more than one campaign
SELECT queue_id, COUNT(DISTINCT campaign_id) c
FROM campaign_queues GROUP BY 1 HAVING c > 1;
```

If the second query returns rows, queues are **not** exclusive today and those campaigns
need a decision before the fold — this build cannot represent a shared queue.

---

## 11. Open decisions — not guessed, switched

The brief lists six genuinely undecided questions. Rather than pick silently, each is a
named switch in `packages/shared/src/policy.ts`, defaulting to the prototype's current
behaviour. Every call site reads from there, so a decision is a one-line change.

| # | Question | Default here | Flip to |
|---|---|---|---|
| 1 | Parent and child both carry a callback | `callbackConflict: 'flag'` — reported as a conflict | `'child-overrides'`, and `effectiveActions()` keeps only the deepest |
| 2 | Transfer code uniqueness scope | `transferCodeScope: 'campaign'`, `transferCodeBlocking: false` — surfaced as a **warning**, so nothing legitimate is blocked while the scope is undecided | `'account'` and/or `blocking: true` |
| 3 | Orphaned DIDs on queue delete | `orphanedDids: 'warn-and-release'` — the numbers go dead, the response names them | `'block-until-reassigned'` (409) |
| 4 | Mixed lead-list schemas on one campaign | `mixedLeadSchemas: 'warn'` | `'block'` |
| 5 | Scope of the `sensitive` flag | `sensitiveScope: 'both'` — masked for agents *and* admins | `'agent-only'` so an admin auditing a list sees real values |
| 6 | Existing 4–5 character codes (`Pytd`, `Plcyi`) | `legacyCodes: 'grandfather'` — the 3-character rule binds new and edited codes only | `'truncate'`, which needs a collision strategy first |

Numbers 2 and 5 are the two worth deciding soonest: 2 is a live correctness gap (an
ambiguous transfer code has no defined destination), and 5 is a security/compliance
judgement rather than a UX one.

---

## 12. Accessibility

The brief flags this as **not done in the prototype**. What this build does:

- toggles are `<button role="switch" aria-checked>` with an accessible name
- the nav rail is a `<nav aria-label="Configuration">` landmark; the active item carries
  `aria-current`
- every section is `<section aria-labelledby>` pointing at its own heading
- every icon-only button has an `aria-label`; a browser test fails the build if one does not
- collapsible sections use `aria-expanded` / `aria-controls`
- modals and drawers are `role="dialog" aria-modal` with a label, Escape to close, and
  focus moved into the dialog
- a skip link, a visible `:focus-visible` ring, and `prefers-reduced-motion` honoured
- form controls are all label-associated; errors use `aria-describedby` and `aria-invalid`

**Not done:** full keyboard navigation of the disposition tree (arrow-key roving
tabindex — rows are reachable and operable, but not arrow-navigable), and a screen-reader
pass with a real screen reader. Both are worth doing before release; the automated checks
prove the markup, not the experience.

---

## 13. What is not built

- **CSV parsing.** Upload endpoints take parsed rows as JSON so the duplicate and dedupe
  rules are exercised end to end; a real multipart parser slots in at the same endpoint.
- **Agent script editing** beyond a named list of sections — the brief puts the rich editor
  out of scope for v1.
- **Auth, tenancy, real persistence.** The store is a JSON file, seeded on first run. It
  implements the same interface a real database adapter would.
- **The record-level audit trail**, permissions, and anything about the agent panel itself.
