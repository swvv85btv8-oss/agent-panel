import { KEYS, getRedis } from '../db/redis';
import { CallQueueItem, Queue } from '../models';

/** Real-time queue-depth counters kept in Redis so the dashboard never scans Mongo. */
export async function incrQueueDepth(queueId: string, by = 1): Promise<number> {
  const n = await getRedis().incrby(KEYS.queueDepth(queueId), by);
  if (n < 0) {
    await getRedis().set(KEYS.queueDepth(queueId), 0);
    return 0;
  }
  return n;
}

export async function decrQueueDepth(queueId: string): Promise<number> {
  return incrQueueDepth(queueId, -1);
}

export async function getQueueDepths(): Promise<Record<string, number>> {
  const queues = await Queue.find().lean();
  if (queues.length === 0) return {};
  const values = await getRedis().mget(queues.map((q) => KEYS.queueDepth(String(q._id))));
  const out: Record<string, number> = {};
  queues.forEach((q, i) => {
    out[String(q._id)] = Number(values[i] ?? 0);
  });
  return out;
}

/** Rebuild the counters from Mongo — used at boot and after a seed. */
export async function resyncQueueDepths(): Promise<Record<string, number>> {
  const rows = await CallQueueItem.aggregate<{ _id: any; count: number }>([
    { $match: { status: { $in: ['waiting', 'offered'] } } },
    { $group: { _id: '$queueId', count: { $sum: 1 } } },
  ]);
  const queues = await Queue.find().lean();
  const counts = new Map(rows.map((r) => [String(r._id), r.count]));
  const pipeline = getRedis().pipeline();
  for (const q of queues) {
    pipeline.set(KEYS.queueDepth(String(q._id)), counts.get(String(q._id)) ?? 0);
  }
  await pipeline.exec();
  return Object.fromEntries(queues.map((q) => [String(q._id), counts.get(String(q._id)) ?? 0]));
}
