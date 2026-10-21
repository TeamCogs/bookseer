import { loadConfig } from './config.js';
import { buildApp } from './app.js';

process.umask(0o077);
const config = loadConfig();
const { app, services, store } = await buildApp(config, { logger: true });
await app.listen({ host: config.host, port: config.port });
const background = new Set<Promise<unknown>>();
function run(task: Promise<unknown>) { background.add(task); void task.catch(() => app.log.warn('A background check did not complete.')).finally(() => background.delete(task)); }
run(services.syncAll());
const sync = setInterval(() => { run(services.syncAll()); }, config.syncIntervalMinutes * 60000);
const poll = setInterval(() => { run(services.refreshRequests()); }, 30000);
let closing = false;
async function shutdown() {
  if (closing) return; closing = true; clearInterval(sync); clearInterval(poll);
  services.cancel(); await app.close(); await Promise.allSettled([...background]); store.close();
}
process.on('SIGTERM', () => { void shutdown(); });
process.on('SIGINT', () => { void shutdown(); });
