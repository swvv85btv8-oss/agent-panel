/**
 * Seed: 6 agents with varied skills, 3 inbound queues (distinct inbound priorities and
 * required skills), 3 outbound campaigns (predictive / progressive / manual), leads and
 * the default wrapUpDurationSeconds setting.
 *
 *   npm run seed
 */
import mongoose from 'mongoose';
import { DEFAULT_WRAP_UP_SECONDS, WRAP_UP_SETTING_KEY } from './config/env';
import { connectMongo, disconnectMongo } from './db/mongo';
import { closeRedis, getRedis } from './db/redis';
import {
  Agent,
  CallQueueItem,
  CallSession,
  Campaign,
  Lead,
  Queue,
  RoutingDecisionLog,
  Setting,
  Skill,
} from './models';

async function seed(): Promise<void> {
  await connectMongo();
  console.log('[seed] clearing collections...');
  const collections = [
    Agent,
    Queue,
    Campaign,
    Lead,
    Skill,
    Setting,
    CallQueueItem,
    CallSession,
    RoutingDecisionLog,
  ] as mongoose.Model<any>[];
  await Promise.all(collections.map((m) => m.deleteMany({})));
  const redis = getRedis();
  const keys = await redis.keys('dialer:*');
  if (keys.length) await redis.del(...keys);

  /* ---------------------------------------------------------------- settings */
  await Setting.create({ key: WRAP_UP_SETTING_KEY, value: DEFAULT_WRAP_UP_SECONDS });

  /* ------------------------------------------------------------------ skills */
  const [support, sales, billing, hindi] = await Skill.create([
    { name: 'support' },
    { name: 'sales' },
    { name: 'billing' },
    { name: 'hindi' },
  ]);

  /* --------------------------------------------- inbound queues (own scale) */
  const [inbVip, inbSupport, inbBilling] = await Queue.create([
    // priority is INBOUND-scoped: 1 beats 2 beats 3, and never touches outbound numbers.
    { name: 'VIP Support', type: 'inbound', priority: 1, requiredSkillId: support._id, minProficiency: 4 },
    { name: 'General Support', type: 'inbound', priority: 2, requiredSkillId: support._id, minProficiency: 2 },
    { name: 'Billing', type: 'inbound', priority: 3, requiredSkillId: billing._id, minProficiency: 2 },
  ]);

  /* ------------------------------------------- outbound queues (own scale) */
  const [outCollections, outWinback, outVerify] = await Queue.create([
    // priority is OUTBOUND-scoped and starts again at 1 — this is a SEPARATE scale.
    { name: 'Collections Dialer', type: 'outbound', priority: 1, requiredSkillId: billing._id, minProficiency: 2 },
    { name: 'Winback Dialer', type: 'outbound', priority: 2, requiredSkillId: sales._id, minProficiency: 2 },
    { name: 'KYC Verification Dialer', type: 'outbound', priority: 3, requiredSkillId: null, minProficiency: 1 },
  ]);

  /* --------------------------------------------------------------- campaigns */
  const [collectionsCampaign, winback, kyc] = await Campaign.create([
    {
      name: 'Collections Q3',
      queueId: outCollections._id,
      dialingMode: 'predictive',
      pacingConfig: {
        initialRatio: 1.5,
        currentRatio: 1.5,
        minRatio: 1,
        maxRatio: 3,
        step: 0.2,
        targetAbandonRate: 0.03,
        intervalMs: 3000,
      },
    },
    {
      name: 'Winback Offers',
      queueId: outWinback._id,
      dialingMode: 'progressive',
      pacingConfig: { intervalMs: 4000 },
    },
    {
      name: 'KYC Callbacks',
      queueId: outVerify._id,
      dialingMode: 'manual',
      pacingConfig: { intervalMs: 5000 },
    },
  ]);

  await Queue.updateOne({ _id: outCollections._id }, { campaignId: collectionsCampaign._id });
  await Queue.updateOne({ _id: outWinback._id }, { campaignId: winback._id });
  await Queue.updateOne({ _id: outVerify._id }, { campaignId: kyc._id });

  /* ------------------------------------------------------------------- leads */
  const leads: any[] = [];
  const mkLeads = (campaignId: any, prefix: string, n: number) => {
    for (let i = 1; i <= n; i += 1) {
      leads.push({
        campaignId,
        phone: `+9198${prefix}${String(i).padStart(5, '0')}`,
        name: `${prefix} lead ${i}`,
        status: 'new',
      });
    }
  };
  mkLeads(collectionsCampaign._id, '100', 60);
  mkLeads(winback._id, '200', 60);
  mkLeads(kyc._id, '300', 60);
  await Lead.insertMany(leads);

  /* ------------------------------------------------------------------ agents */
  // Deliberately blended: every agent below sits on inbound AND outbound queues at once.
  const agents = [
    {
      name: 'Asha Menon',
      extension: '1001',
      status: 'offline',
      skills: [
        { skillId: support._id, proficiency: 5 },
        { skillId: hindi._id, proficiency: 4 },
      ],
      assignedQueues: [
        { queueId: inbVip._id, type: 'inbound', rankOverride: null },
        { queueId: inbSupport._id, type: 'inbound', rankOverride: null },
        { queueId: outVerify._id, type: 'outbound', rankOverride: null },
      ],
    },
    {
      name: 'Rahul Verma',
      extension: '1002',
      status: 'offline',
      skills: [
        { skillId: support._id, proficiency: 3 },
        { skillId: billing._id, proficiency: 4 },
      ],
      // 2 inbound + 2 outbound — the worked example in the README uses this agent.
      assignedQueues: [
        { queueId: inbSupport._id, type: 'inbound', rankOverride: null },
        { queueId: inbBilling._id, type: 'inbound', rankOverride: null },
        { queueId: outCollections._id, type: 'outbound', rankOverride: null },
        { queueId: outWinback._id, type: 'outbound', rankOverride: null },
      ],
    },
    {
      name: 'Neha Kulkarni',
      extension: '1003',
      status: 'offline',
      skills: [
        { skillId: sales._id, proficiency: 5 },
        { skillId: billing._id, proficiency: 3 },
      ],
      // rankOverride flips this agent's outbound preference to Winback even though
      // Collections has the better outbound priority.
      assignedQueues: [
        { queueId: inbBilling._id, type: 'inbound', rankOverride: null },
        { queueId: outWinback._id, type: 'outbound', rankOverride: 1 },
        { queueId: outCollections._id, type: 'outbound', rankOverride: 5 },
      ],
    },
    {
      name: 'Imran Shaikh',
      extension: '1004',
      status: 'offline',
      skills: [
        { skillId: support._id, proficiency: 4 },
        { skillId: sales._id, proficiency: 3 },
      ],
      assignedQueues: [
        { queueId: inbVip._id, type: 'inbound', rankOverride: null },
        { queueId: outWinback._id, type: 'outbound', rankOverride: null },
        { queueId: outVerify._id, type: 'outbound', rankOverride: null },
      ],
    },
    {
      name: 'Priya Nair',
      extension: '1005',
      status: 'offline',
      skills: [
        { skillId: billing._id, proficiency: 5 },
        { skillId: hindi._id, proficiency: 3 },
      ],
      assignedQueues: [
        { queueId: inbBilling._id, type: 'inbound', rankOverride: null },
        { queueId: outCollections._id, type: 'outbound', rankOverride: null },
      ],
    },
    {
      name: 'Vikram Rao',
      extension: '1006',
      status: 'offline',
      // Sales only: not skilled for any inbound queue, so he is a pure outbound agent
      // and shows the skill gate rejecting inbound work.
      skills: [{ skillId: sales._id, proficiency: 4 }],
      assignedQueues: [
        { queueId: inbSupport._id, type: 'inbound', rankOverride: null },
        { queueId: outWinback._id, type: 'outbound', rankOverride: null },
        { queueId: outVerify._id, type: 'outbound', rankOverride: null },
      ],
    },
  ];
  await Agent.create(agents as any);

  console.log('[seed] done:');
  console.log(`  settings : ${WRAP_UP_SETTING_KEY} = ${DEFAULT_WRAP_UP_SECONDS}s`);
  console.log('  inbound  : VIP Support(p1) > General Support(p2) > Billing(p3)');
  console.log('  outbound : Collections(p1, predictive) > Winback(p2, progressive) > KYC(p3, manual)');
  console.log(`  agents   : ${agents.length}, leads: ${leads.length}`);

  await disconnectMongo();
  await closeRedis();
}

seed().catch(async (e) => {
  console.error('[seed] failed', e);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
