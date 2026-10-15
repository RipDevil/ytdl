import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { resolve } from 'node:path';
import { createDownloader, parseOutput } from '../server/downloader.js';
import { deferred, firstUrl, temporaryDirectory } from './helpers.js';

function fakeChild() {
  const completion = deferred();
  const child = Object.assign(completion.promise, {
    stdout: new PassThrough(), stderr: new PassThrough(),
    kill: (signal) => {
      child.stdout.end();
      child.stderr.end();
      completion.reject(new Error(`Killed with ${signal}`));
    },
  });
  return {
    child,
    finish: () => { child.stdout.end(); child.stderr.end(); completion.resolve(); },
    fail: () => { child.stdout.end(); child.stderr.end(); completion.reject(new Error('Process failed')); },
  };
}

test('parses machine-readable metadata and progress without trusting ordinary output', () => {
  assert.deepEqual(parseOutput('__TOMATO_META__"A title"'), { title: 'A title' });
  assert.deepEqual(parseOutput('__TOMATO_FILE__"/downloads/video.webm"'), { filename: '/downloads/video.webm' });
  assert.deepEqual(parseOutput('__TOMATO_PROGRESS__{"percent":" 24.5%","speed":1048576,"eta":4}'), {
    progress: { stage: 'downloading', percent: 24.5, speed: 1048576, eta: 4 },
  });
  assert.equal(parseOutput('__TOMATO_PROGRESS__{"percent":"NA"}').progress.percent, null);
  assert.equal(parseOutput('__TOMATO_PROGRESS__{"percent":150}').progress.percent, 100);
  assert.equal(parseOutput('__TOMATO_PROGRESS__{"stage":"processing"}').progress.stage, 'processing');
  for (const line of ['[download] ordinary output', '__TOMATO_META__{broken', '__TOMATO_PROGRESS__null', '__TOMATO_FILE__42']) {
    assert.equal(parseOutput(line), null);
  }
});

test('streams metadata and progress, requests best quality, and returns a relative filename', async (t) => {
  const directory = await temporaryDirectory(t);
  const process = fakeChild();
  const started = deferred();
  const updates = [];
  const download = createDownloader({ downloadsDir: directory, exec: (url, flags, options) => {
    assert.equal(url, firstUrl);
    assert.equal(flags.noPlaylist, true);
    assert.equal(flags.format, 'bv*+ba/b');
    assert.equal(flags.paths, directory);
    assert.equal(flags.ignoreConfig, true);
    assert.notEqual(options.shell, true);
    started.resolve();
    return process.child;
  } });
  const result = download({ url: firstUrl }, { signal: new AbortController().signal, onProgress: (update) => updates.push(update) });
  await started.promise;
  process.child.stdout.write('__TOMATO_META__"A title"\n');
  process.child.stderr.write('__TOMATO_PROGRESS__{"percent":"50.0%","speed":1000,"eta":2}\n');
  process.child.stdout.write(`__TOMATO_FILE__${JSON.stringify(resolve(directory, 'video.webm'))}\n`);
  process.finish();
  assert.deepEqual(await result, { title: 'A title', filename: 'video.webm' });
  assert.ok(updates.some((update) => update.progress.percent === 50));
});

test('rejects completion paths escaping the output folder', async (t) => {
  const directory = await temporaryDirectory(t);
  const process = fakeChild();
  const started = deferred();
  const download = createDownloader({ downloadsDir: directory, exec: () => { started.resolve(); return process.child; } });
  const result = download({ url: firstUrl }, { signal: new AbortController().signal, onProgress() {} });
  const rejection = assert.rejects(result, /outside the downloads directory/);
  await started.promise;
  process.child.stdout.write('__TOMATO_FILE__"../escape.mp4"\n');
  process.finish();
  await rejection;
});

test('reports downloader diagnostics on failure and rejects success without a filename', async (t) => {
  const directory = await temporaryDirectory(t);
  for (const fail of [true, false]) {
    const process = fakeChild();
    const started = deferred();
    const download = createDownloader({ downloadsDir: directory, exec: () => { started.resolve(); return process.child; } });
    const result = download({ url: firstUrl }, { signal: new AbortController().signal, onProgress() {} });
    const rejection = assert.rejects(result, fail ? /Video unavailable/ : /did not report a completed file/);
    await started.promise;
    if (fail) { process.child.stderr.write('ERROR: Video unavailable\n'); process.fail(); }
    else process.finish();
    await rejection;
  }
});

test('abort stops the fake subprocess and propagates cancellation', async (t) => {
  const directory = await temporaryDirectory(t);
  const process = fakeChild();
  const started = deferred();
  const controller = new AbortController();
  const download = createDownloader({ downloadsDir: directory, exec: () => { started.resolve(); return process.child; } });
  const result = download({ url: firstUrl }, { signal: controller.signal, onProgress() {} });
  const rejection = assert.rejects(result, { name: 'AbortError' });
  await started.promise;
  controller.abort();
  await rejection;
});
