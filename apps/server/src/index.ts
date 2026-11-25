import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { Store } from './db.js';
import { Updater } from './updater.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const DATA = join(ROOT, 'data');
const PORT = Number(process.env.PCH_PORT ?? 8787);
const HOST = '127.0.0.1'; // local only: never exposed to the network

const store = new Store(process.env.PCH_DB ?? join(DATA, 'hub.db'));
const backup = store.backup(join(DATA, 'backups'));
if (backup) console.log(`Backup: ${relative(ROOT, backup)}`);

const updater = new Updater(ROOT, store);
updater.start();
const app = createApp({ store, dataDir: DATA, updater });

// Production: serve the built web app from the same port.
const WEB_DIST = join(ROOT, 'apps/web/dist');
if (existsSync(WEB_DIST)) {
  const root = relative(process.cwd(), WEB_DIST);
  app.use('/*', serveStatic({ root }));
  app.get('*', serveStatic({ root, path: 'index.html' }));
}

serve({ fetch: app.fetch, port: PORT, hostname: HOST }, () => console.log(`PCH server on http://${HOST}:${PORT}`));
