import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../server/app.js';
import { DownloadQueue } from '../server/queue.js';
import { firstUrl, memoryStore } from './helpers.js';

async function setup(t, store = memoryStore()) {
  const queue = new DownloadQueue({ store, download: async () => assert.fail('API unit tests must not download') });
  await queue.init();
  const app = buildApp({ queue, serveFrontend: false, logger: false });
  t.after(() => app.close());
  return { app, queue };
}

test('health, submission and listing work without opening a listening socket', async (t) => {
  const { app } = await setup(t);
  assert.deepEqual((await app.inject('/api/health')).json(), { status: 'ok' });
  const response = await app.inject({ method: 'POST', url: '/api/jobs', payload: { url: `${firstUrl}&list=PL123` } });
  assert.equal(response.statusCode, 201);
  assert.equal(response.json().job.url, firstUrl);
  assert.equal(response.json().job.status, 'queued');
  const listing = await app.inject('/api/jobs');
  assert.equal(listing.headers['cache-control'], 'no-store');
  assert.equal(listing.json().jobs.length, 1);
  assert.equal(listing.json().jobs[0].id, response.json().job.id);
});

test('invalid bodies and unsupported URLs return 400 without enqueuing', async (t) => {
  const { app, queue } = await setup(t);
  for (const payload of [{}, { url: '' }, { url: {} }, { url: 'https://example.com' }, { url: 'https://youtube.com/playlist?list=PL123' }]) {
    const response = await app.inject({ method: 'POST', url: '/api/jobs', payload });
    assert.equal(response.statusCode, 400);
    assert.equal(typeof response.json().error, 'string');
  }
  const malformed = await app.inject({ method: 'POST', url: '/api/jobs', headers: { 'content-type': 'application/json' }, payload: '{bad' });
  assert.equal(malformed.statusCode, 400);
  assert.equal(queue.list().length, 0);
});

test('storage failures return 503 instead of claiming the job was accepted', async (t) => {
  const { app } = await setup(t, { load: async () => [], save: async () => { throw new Error('Disk full'); } });
  const response = await app.inject({ method: 'POST', url: '/api/jobs', payload: { url: firstUrl } });
  assert.equal(response.statusCode, 503);
});

test('health reports a stopped worker and unsupported routes do not serve files', async (t) => {
  const { app, queue } = await setup(t);
  queue.error = new Error('Disk full');
  assert.equal((await app.inject('/api/health')).statusCode, 503);
  assert.match((await app.inject('/api/jobs')).json().queueError, /Queue paused/);
  assert.equal((await app.inject('/downloads/video.mp4')).statusCode, 404);
});
