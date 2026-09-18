import { DEFAULT_WRAP_UP_SECONDS, WRAP_UP_SETTING_KEY } from '../config/env';
import { Setting } from '../models';
import { emit } from '../ws/bus';

/** Wrap-up duration is configuration, never a constant in the routing path. */
export async function getWrapUpSeconds(): Promise<number> {
  const doc = await Setting.findOne({ key: WRAP_UP_SETTING_KEY }).lean();
  const value = Number(doc?.value);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_WRAP_UP_SECONDS;
}

export async function setWrapUpSeconds(seconds: number): Promise<number> {
  if (!Number.isFinite(seconds) || seconds < 1 || seconds > 3600) {
    throw new Error('wrapUpDurationSeconds must be between 1 and 3600');
  }
  await Setting.findOneAndUpdate(
    { key: WRAP_UP_SETTING_KEY },
    { key: WRAP_UP_SETTING_KEY, value: Math.floor(seconds) },
    { upsert: true, new: true },
  );
  emit('settings:updated', { key: WRAP_UP_SETTING_KEY, value: Math.floor(seconds) });
  return Math.floor(seconds);
}

export async function getAllSettings(): Promise<Record<string, any>> {
  const rows = await Setting.find().lean();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}
