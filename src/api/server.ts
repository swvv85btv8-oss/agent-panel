import express from 'express';
import path from 'path';
import { agentsRouter } from './routes/agents';
import { adminRouter } from './routes/admin';
import { simulateRouter } from './routes/simulate';

export function createApp() {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/agents', agentsRouter);
  app.use('/api/admin', adminRouter);
  app.use('/simulate', simulateRouter);

  // The two minimal POC frontends.
  app.use(express.static(path.join(__dirname, '../../public')));
  app.get('/', (_req, res) => res.redirect('/agent.html'));

  return app;
}
