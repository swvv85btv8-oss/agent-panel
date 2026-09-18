import 'dotenv/config';

export const env = {
  port: Number(process.env.PORT ?? 4000),
  mongoUrl: process.env.MONGO_URL ?? 'mongodb://127.0.0.1:27017/acefone_dialer_poc',
  redisUrl: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
  assignmentTickMs: Number(process.env.ASSIGNMENT_TICK_MS ?? 1000),
  simulatorEnabled: (process.env.SIMULATOR_ENABLED ?? 'true') === 'true',
  simulatorInboundTickMs: Number(process.env.SIMULATOR_INBOUND_TICK_MS ?? 2000),
  simulatorCampaignTickMs: Number(process.env.SIMULATOR_CAMPAIGN_TICK_MS ?? 3000),
  simCallMinMs: Number(process.env.SIM_CALL_MIN_MS ?? 8000),
  simCallMaxMs: Number(process.env.SIM_CALL_MAX_MS ?? 20000),
};

export const WRAP_UP_SETTING_KEY = 'wrapUpDurationSeconds';
export const DEFAULT_WRAP_UP_SECONDS = 30;
