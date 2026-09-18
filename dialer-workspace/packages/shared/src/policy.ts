/**
 * OPEN PRODUCT DECISIONS (build prompt §10).
 *
 * Each of these is genuinely undecided and changes behaviour. Rather than guess
 * silently, each is a named switch with an explicit default that reproduces the
 * prototype's current behaviour. When the product owner decides, flip the value
 * here — every call site reads from this module, so it is a one-line change.
 *
 * Nothing else in the codebase hard-codes any of these choices.
 */
export const POLICY = {
  /**
   * §10.1 Callback window conflict.
   * A parent and a child on the same path both carry a callback action.
   *   'flag'           — treat as a conflict the user must resolve  (prototype behaviour)
   *   'child-overrides'— the deepest callback wins, no conflict raised
   */
  callbackConflict: 'flag' as 'flag' | 'child-overrides',

  /**
   * §10.2 Transfer code uniqueness.
   * An ambiguous transfer code has no defined destination — the same class of
   * problem as a DID collision, which the prototype leaves unchecked.
   *   scope:    which set codes must be unique within
   *   blocking: false surfaces it as a warning so nothing legitimate is wrongly
   *             blocked while the scope is still undecided
   */
  transferCodeScope: 'campaign' as 'campaign' | 'account' | 'off',
  transferCodeBlocking: false,

  /**
   * §10.3 Orphaned DIDs when a queue is deleted.
   *   'warn-and-release'      — numbers go dead; warn, naming them  (prototype behaviour)
   *   'block-until-reassigned'— refuse the delete until they are moved
   */
  orphanedDids: 'warn-and-release' as 'warn-and-release' | 'block-until-reassigned',

  /**
   * §10.4 Mixed lead-list schemas on one campaign.
   *   'warn'  — surface the mismatch, allow publish  (prototype behaviour)
   *   'block' — a campaign's lists must share a schema
   */
  mixedLeadSchemas: 'warn' as 'warn' | 'block',

  /**
   * §10.5 Scope of the `sensitive` flag.
   *   'both'       — masked in the agent panel AND the admin records table  (prototype)
   *   'agent-only' — admins auditing a list see real values
   */
  sensitiveScope: 'both' as 'both' | 'agent-only',

  /**
   * §10.6 Existing disposition codes are 4–5 characters (`Pytd`, `Plcyi`).
   *   'grandfather' — the 3-character rule binds new and edited codes only  (prototype)
   *   'truncate'    — migrate existing codes down to 3, resolving collisions
   */
  legacyCodes: 'grandfather' as 'grandfather' | 'truncate',
};

export type Policy = typeof POLICY;
