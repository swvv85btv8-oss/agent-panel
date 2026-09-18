import path from 'path';
import { createApp } from './app';
import { buildSeed } from './db/seed';
import { Store, setStore } from './db/store';

const PORT = Number(process.env.PORT ?? 4100);
const DATA_FILE = process.env.DATA_FILE ?? path.join(process.cwd(), 'data', 'db.json');

const store = setStore(new Store(DATA_FILE));
if (!store.db.campaigns.length) {
  console.log('[server] empty store — seeding defaults');
  store.reset(buildSeed());
  store.flush();
}

createApp().listen(PORT, () => {
  console.log(`[server] http://localhost:${PORT}`);
  console.log(`[server] data file: ${DATA_FILE}`);
});
