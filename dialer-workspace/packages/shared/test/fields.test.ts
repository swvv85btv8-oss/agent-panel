import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CAMPAIGN_DEFAULTS,
  MAX_LEAD_LISTS,
  PACING,
  PHASES,
  QUEUE_SECTIONS,
  SECTIONS,
  allCampaignFields,
  campaignIssues,
  isEmpty,
  orderedSections,
  visible,
} from '../src';

const values = (over: Record<string, unknown> = {}) =>
  ({ ...CAMPAIGN_DEFAULTS, ...over }) as any;

describe('field inventory', () => {
  it('has 11 sections across 4 lifecycle phases', () => {
    assert.equal(SECTIONS.length, 11);
    assert.equal(PHASES.length, 4);
    assert.equal(orderedSections().length, 11);
  });

  it('carries 59 campaign fields', () => {
    const n = SECTIONS.reduce((a, s) => a + s.fields.length, 0);
    assert.equal(n, 59);
  });

  it('splits into the documented per-phase counts', () => {
    const count = (phase: string) =>
      SECTIONS.filter((s) => s.phase === phase).reduce((a, s) => a + s.fields.length, 0);
    assert.equal(count('setup'), 30);
    assert.equal(count('during'), 9);
    assert.equal(count('post'), 18);
    assert.equal(count('inbound'), 2);
  });

  it('carries 37 inbound queue fields', () => {
    const n = QUEUE_SECTIONS.reduce((a, s) => a + s.fields.length, 0);
    assert.equal(n, 37);
  });

  it('numbers sections continuously 1-11 in phase order', () => {
    const ordered = orderedSections().map((s) => s.phase);
    const firstIndex = (p: string) => ordered.indexOf(p);
    assert.ok(firstIndex('setup') < firstIndex('during'));
    assert.ok(firstIndex('during') < firstIndex('post'));
    assert.ok(firstIndex('post') < firstIndex('inbound'));
  });

  it('declares dependsOn wherever a when predicate exists', () => {
    // String(fn).includes(id) would break under a minified production build,
    // so every conditional field states its dependencies explicitly.
    const all = [...SECTIONS.flatMap((s) => s.fields), ...QUEUE_SECTIONS.flatMap((s) => s.fields)];
    all
      .filter((f) => f.when)
      .forEach((f) => {
        assert.ok(f.dependsOn?.length, `${f.id} has a when predicate but no dependsOn`);
      });
  });

  it('keeps every dependent field in the same section as its toggle', () => {
    SECTIONS.forEach((s) => {
      s.fields.forEach((f) => {
        (f.dependsOn ?? []).forEach((dep) => {
          assert.ok(
            s.fields.some((x) => x.id === dep),
            `${f.id} depends on ${dep}, which is in another section`,
          );
        });
      });
    });
  });

  it('caps lead lists at 3', () => {
    assert.equal(MAX_LEAD_LISTS, 3);
  });
});

describe('mandatory fields', () => {
  const ALWAYS = [
    'name',
    'callerId',
    'dispositionList',
    'dialMethod',
    'wrapUp',
    'acw',
    'connMethod',
    'agentGroup',
    'connectThrough',
    'ringTimeout',
    'dialStatus',
  ];

  it('marks exactly the 11 always-required named fields (plus >=1 lead list)', () => {
    const req = SECTIONS.flatMap((s) => s.fields)
      .filter((f) => f.req && !f.when)
      .map((f) => f.id)
      .sort();
    assert.deepEqual(req, [...ALWAYS].sort());
  });

  it('counts 12 always-on mandatory rules: 11 named fields plus >=1 lead list', () => {
    const named = SECTIONS.flatMap((s) => s.fields).filter((f) => f.req && !f.when).length;
    assert.equal(named + 1, 12);
  });

  it('leaves 8 of them open on a blank campaign, the other 4 having defaults', () => {
    const iss = campaignIssues(values());
    const prefilled = ['dialMethod', 'connMethod', 'connectThrough', 'dialStatus'];
    prefilled.forEach((id) => {
      assert.ok(!isEmpty(CAMPAIGN_DEFAULTS[id]), `${id} should ship with a default`);
      assert.ok(!iss.some((i) => i.id === id), `${id} should not be reported`);
    });
    assert.equal(iss.length, 12 - prefilled.length);
    assert.ok(iss.some((i) => i.id === '__leads'));
  });

  it('marks 7 conditionally-required fields', () => {
    const conditional = SECTIONS.flatMap((s) => s.fields)
      .filter((f) => f.req && f.when)
      .map((f) => f.id)
      .sort();
    assert.deepEqual(conditional, [
      'csatSurvey',
      'manualCallerId',
      'pauseCodeList',
      'popupUrl',
      'skillList',
      'webformUrl',
    ]);
    // the seventh is ">=1 inbound queue", which is a rule rather than a field
    const iss = campaignIssues(values({ inbound: true }));
    assert.ok(iss.some((i) => i.id === 'queues'));
  });
});

describe('progressive disclosure', () => {
  it('excludes a hidden required field from validation', () => {
    const off = campaignIssues(values());
    assert.ok(!off.some((i) => i.id === 'csatSurvey'));
    const on = campaignIssues(values({ enableCsat: true }));
    assert.ok(on.some((i) => i.id === 'csatSurvey'));
  });

  it('hides the survey field until CSAT is enabled', () => {
    const f = SECTIONS.find((s) => s.id === 'outcomes')!.fields.find((x) => x.id === 'csatSurvey')!;
    assert.equal(visible(f, values()), false);
    assert.equal(visible(f, values({ enableCsat: true })), true);
  });

  it('gates all three transfer sub-settings behind one toggle', () => {
    const s = SECTIONS.find((x) => x.id === 'transfers')!;
    const gated = s.fields.filter((f) => (f.dependsOn ?? []).includes('allowTransfer'));
    assert.equal(gated.length, 3);
    gated.forEach((f) => assert.equal(visible(f, values()), false));
  });
});

describe('pacing by dial method', () => {
  it('requires nothing extra for Progressive', () => {
    assert.equal(PACING.Progressive.fields.length, 0);
    const iss = campaignIssues(values({ dialMethod: 'Progressive' }));
    assert.ok(!iss.some((i) => i.id.startsWith('pacing')));
  });

  it('requires ratio and abandon rate for Predictive', () => {
    const iss = campaignIssues(values({ dialMethod: 'Predictive' })).map((i) => i.id);
    assert.ok(iss.includes('pacingRatio'));
    assert.ok(iss.includes('maxAbandon'));
  });

  it('requires lines per agent for Power, dial ratio for Ratio, timeout for Preview', () => {
    assert.ok(campaignIssues(values({ dialMethod: 'Power' })).some((i) => i.id === 'linesPerAgent'));
    assert.ok(campaignIssues(values({ dialMethod: 'Ratio' })).some((i) => i.id === 'dialRatio'));
    assert.ok(
      campaignIssues(values({ dialMethod: 'Preview' })).some((i) => i.id === 'previewTimeout'),
    );
  });

  it('swaps pacing fields when the dial method changes', () => {
    const predictive = allCampaignFields(values({ dialMethod: 'Predictive' })).map((f) => f.id);
    const power = allCampaignFields(values({ dialMethod: 'Power' })).map((f) => f.id);
    assert.ok(predictive.includes('pacingRatio'));
    assert.ok(!power.includes('pacingRatio'));
    assert.ok(power.includes('linesPerAgent'));
  });
});
