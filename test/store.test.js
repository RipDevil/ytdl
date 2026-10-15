import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { JsonStore } from '../server/store.js';
import { firstUrl, temporaryDirectory } from './helpers.js';

test('a new store is empty, saves atomically, and reloads without temporary files', async (t) => {
  const directory = await temporaryDirectory(t);
  const filename = resolve(directory, 'queue.json');
  const store = new JsonStore(filename);
  assert.deepEqual(await store.load(), []);
  const jobs = [{ id: 'job', url: firstUrl, status: 'queued' }];
  await store.save(jobs);
  assert.deepEqual(await new JsonStore(filename).load(), jobs);
  assert.deepEqual(await readdir(directory), ['queue.json']);
  await store.save([{ ...jobs[0], status: 'completed' }]);
  assert.equal((await store.load())[0].status, 'completed');
});

test('corrupted or unsupported state fails without replacing the original file', async (t) => {
  const directory = await temporaryDirectory(t);
  const filename = resolve(directory, 'queue.json');
  for (const content of [
    '{broken',
    JSON.stringify({ version: 2, jobs: [] }),
    JSON.stringify({ version: 1, jobs: [{ id: 'bad', url: firstUrl, status: 'unknown' }] }),
    JSON.stringify({ version: 1, jobs: Array(2).fill({ id: 'duplicate', url: firstUrl, status: 'queued' }) }),
  ]) {
    await writeFile(filename, content);
    await assert.rejects(new JsonStore(filename).load());
    assert.equal(await readFile(filename, 'utf8'), content);
  }
});
