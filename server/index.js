import { resolve } from 'node:path';
import { buildApp } from './app.js';
import { createDownloader } from './downloader.js';
import { DownloadQueue } from './queue.js';
import { JsonStore } from './store.js';

const downloadsDir = resolve(process.env.DOWNLOADS_DIR || './downloads');
const dataDir = resolve(process.env.DATA_DIR || './data');
const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');

const queue = new DownloadQueue({
  store: new JsonStore(resolve(dataDir, 'queue.json')),
  download: createDownloader({ downloadsDir, binaryPath: process.env.YT_DLP_PATH || 'yt-dlp' }),
  onError: (error) => app.log.error(error, 'Queue stopped'),
});
const app = buildApp({ queue, serveFrontend: process.env.NODE_ENV !== 'development' });

try {
  await queue.init();
  await app.listen({ port, host: '0.0.0.0' });
  queue.start();
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exitCode = 1;
}

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  try {
    await app.close();
  } catch (error) {
    app.log.error(error);
    process.exitCode = 1;
  }
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
