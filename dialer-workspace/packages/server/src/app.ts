import cors from 'cors';
import express from 'express';
import { campaignsRouter } from './routes/campaigns';
import { dispositionSetsRouter } from './routes/disposition-sets';
import { leadListsRouter } from './routes/lead-lists';
import { dndRouter, simpleRouter, surveysRouter, transferRouter } from './routes/library';
import { metaRouter } from './routes/meta';
import { errorMiddleware } from './lib/http';
import { buildSeed } from './db/seed';
import { getStore } from './db/store';

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '25mb' }));

  app.get('/health', (_req, res) => res.json({ ok: true }));

  app.use('/api/campaigns', campaignsRouter);
  app.use('/api/lead-lists', leadListsRouter);
  app.use('/api/disposition-sets', dispositionSetsRouter);
  app.use('/api/surveys', surveysRouter);
  app.use('/api/dnd-lists', dndRouter);
  app.use('/api/transfer-directories', transferRouter);
  app.use('/api/pause-code-sets', simpleRouter('pauseCodeSets', 'pauseCodeSets', 'Pause code set'));
  app.use('/api/skill-lists', simpleRouter('skillLists', 'skillLists', 'Skill list'));
  app.use('/api/agent-scripts', simpleRouter('agentScripts', 'agentScripts', 'Agent script'));
  app.use('/api/meta', metaRouter);

  /** Reset to seeded defaults — handy for demos, and used by the test suite. */
  app.post('/api/dev/reseed', (_req, res) => {
    getStore().reset(buildSeed());
    res.json({ ok: true });
  });

  app.use(errorMiddleware);
  return app;
}
