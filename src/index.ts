import http from 'http';
import { createApp } from './api/server';
import { env } from './config/env';
import { connectMongo } from './db/mongo';
import { closeRedis } from './db/redis';
import { startAssignmentLoop, stopAssignmentLoop } from './services/assignmentService';
import { resyncQueueDepths } from './services/queueDepth';
import { startWrapUpWatcher, stopWrapUpWatcher } from './services/wrapUpService';
import { startSimulator, setSimulatorEnabled, stopSimulator } from './simulator';
import { initSocket } from './ws/bus';

async function main(): Promise<void> {
  await connectMongo();
  await resyncQueueDepths();

  const app = createApp();
  const server = http.createServer(app);
  initSocket(server);

  await startWrapUpWatcher();
  startAssignmentLoop(env.assignmentTickMs);

  startSimulator();
  setSimulatorEnabled(env.simulatorEnabled);

  server.listen(env.port, () => {
    console.log(`[http] listening on http://localhost:${env.port}`);
    console.log(`[http] agent desktop     -> http://localhost:${env.port}/agent.html`);
    console.log(`[http] supervisor view   -> http://localhost:${env.port}/supervisor.html`);
  });

  const shutdown = async () => {
    console.log('\n[shutdown] stopping...');
    stopSimulator();
    stopAssignmentLoop();
    stopWrapUpWatcher();
    server.close();
    await closeRedis();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  console.error('[fatal]', e);
  process.exit(1);
});
