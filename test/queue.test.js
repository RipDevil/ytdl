import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { DownloadQueue } from '../server/queue.js';
import { JsonStore } from '../server/store.js';
import { deferred, firstUrl, memoryStore, secondUrl, temporaryDirectory } from './helpers.js';

test('enqueue is durable and immediate while a download is blocked; jobs run strictly FIFO', async () => {
  const gates = [deferred(), deferred(), deferred()];
  const firstStarted = deferred();
  const calls = [];
  let active = 0;
  let maximum = 0;
  const queue = new DownloadQueue({
    store: memoryStore(),
    download: async (job, { onProgress }) => {
      const index = calls.length;
      calls.push(job.id);
      active++;
      maximum = Math.max(maximum, active);
      onProgress({ title: `Video ${index}`, progress: { stage: 'downloading', percent: 25 } });
      if (!index) firstStarted.resolve();
      await gates[index].promise;
      active--;
      return { title: `Video ${index}`, filename: `${index}.webm` };
    },
  });
  await queue.init();
  const first = await queue.enqueue(firstUrl);
  queue.start();
  await firstStarted.promise;
  const second = await queue.enqueue(secondUrl);
  const third = await queue.enqueue(firstUrl);
  assert.deepEqual(calls, [first.id]);
  assert.deepEqual(queue.list().map((job) => job.status), ['downloading', 'queued', 'queued']);
  assert.equal(queue.list()[0].progress.percent, 25);
  queue.list()[0].progress.percent = 99;
  assert.equal(queue.list()[0].progress.percent, 25);
  gates.forEach((gate) => gate.resolve());
  await queue.idle();
  assert.deepEqual(calls, [first.id, second.id, third.id]);
  assert.equal(maximum, 1);
  assert.ok(queue.list().every((job) => job.status === 'completed' && job.finishedAt));
  await queue.stop();
});

test('a failed download records its error and does not block the next video', async () => {
  const queue = new DownloadQueue({
    store: memoryStore(),
    download: async (job) => {
      if (job.url === firstUrl) throw new Error('Video unavailable');
      return { title: 'Second', filename: 'second.mp4' };
    },
  });
  await queue.init();
  await queue.enqueue(firstUrl);
  await queue.enqueue(secondUrl);
  queue.start();
  await queue.idle();
  assert.equal(queue.list()[0].status, 'failed');
  assert.equal(queue.list()[0].error, 'Video unavailable');
  assert.equal(queue.list()[1].status, 'completed');
  assert.equal(queue.list()[1].filename, 'second.mp4');
  await queue.stop();
});

test('concurrent submissions persist every job without losing updates', async () => {
  const store = memoryStore();
  const queue = new DownloadQueue({ store, download: async () => ({ filename: 'video.webm' }) });
  await queue.init();
  const jobs = await Promise.all(Array.from({ length: 12 }, () => queue.enqueue(firstUrl)));
  assert.equal(new Set(jobs.map((job) => job.id)).size, 12);
  assert.deepEqual((await store.load()).map((job) => job.id), jobs.map((job) => job.id));
});

test('shutdown aborts the active job and a new queue recovers pending work in order', async (t) => {
  const directory = await temporaryDirectory(t);
  const filename = resolve(directory, 'queue.json');
  const started = deferred();
  const queue = new DownloadQueue({
    store: new JsonStore(filename),
    download: (_job, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      started.resolve();
    }),
  });
  await queue.init();
  const first = await queue.enqueue(firstUrl);
  await queue.enqueue(secondUrl);
  queue.start();
  await started.promise;
  await queue.stop();
  assert.deepEqual(queue.list().map((job) => job.status), ['queued', 'queued']);
  const calls = [];
  const recovered = new DownloadQueue({
    store: new JsonStore(filename),
    download: async (job) => { calls.push(job.id); return { filename: 'saved.webm' }; },
  });
  await recovered.init();
  recovered.start();
  await recovered.idle();
  assert.equal(calls[0], first.id);
  assert.equal(calls.length, 2);
  assert.ok(recovered.list().every((job) => job.status === 'completed'));
  await recovered.stop();
});

test('an unclean restart requeues downloading jobs ahead of later pending jobs', async () => {
  const store = memoryStore([
    { id: 'done', url: firstUrl, status: 'completed' },
    { id: 'interrupted', url: firstUrl, status: 'downloading', progress: { percent: 40 } },
    { id: 'waiting', url: secondUrl, status: 'queued' },
  ]);
  const queue = new DownloadQueue({ store, download: async () => ({ filename: 'saved.webm' }) });
  await queue.init();
  assert.deepEqual(queue.list().map((job) => job.status), ['completed', 'queued', 'queued']);
  assert.equal((await store.load())[1].progress, null);
});

test('a failed enqueue does not acknowledge or retain an unsaved job', async () => {
  const queue = new DownloadQueue({
    store: { load: async () => [], save: async () => { throw new Error('Disk full'); } },
    download: async () => assert.fail('Must not download an unsaved job'),
  });
  await queue.init();
  await assert.rejects(queue.enqueue(firstUrl), /Disk full/);
  assert.deepEqual(queue.list(), []);
});

test('a state write failure stops the worker without launching another download', async () => {
  const store = memoryStore();
  const errors = [];
  const queue = new DownloadQueue({
    store,
    download: async () => assert.fail('Must not launch before saving the active state'),
    onError: (error) => errors.push(error),
  });
  await queue.init();
  await queue.enqueue(firstUrl);
  store.save = async () => { throw new Error('Storage unavailable'); };
  queue.start();
  await queue.idle();
  assert.match(queue.error.message, /Storage unavailable/);
  assert.equal(errors.length, 1);
  assert.equal(queue.list()[0].status, 'queued');
  await assert.rejects(queue.enqueue(secondUrl), /queue is unavailable/);
});
