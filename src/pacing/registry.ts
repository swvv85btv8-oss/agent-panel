import { DialingMode } from '../routing/types';
import { PacingStrategy } from './strategy';
import {
  manualStrategy,
  powerStrategy,
  predictiveStrategy,
  previewStrategy,
  progressiveStrategy,
  ratioStrategy,
} from './strategies';

const registry = new Map<DialingMode, PacingStrategy>();

/** Register (or replace) a pacing strategy. This is the extension point for new dialing modes. */
export function registerPacingStrategy(strategy: PacingStrategy): void {
  registry.set(strategy.mode, strategy);
}

export function getPacingStrategy(mode: DialingMode): PacingStrategy {
  const s = registry.get(mode);
  if (!s) throw new Error(`No pacing strategy registered for dialing mode "${mode}"`);
  return s;
}

export function listPacingStrategies(): PacingStrategy[] {
  return [...registry.values()];
}

[
  predictiveStrategy,
  progressiveStrategy,
  previewStrategy,
  powerStrategy,
  ratioStrategy,
  manualStrategy,
].forEach(registerPacingStrategy);
