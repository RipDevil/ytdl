import { randomUUID } from 'node:crypto';
import { normalizeVideoUrl } from './urls.js';

export class DownloadQueue {
  constructor({ store, download, onError = console.error }) {
    this.store = store;
    this.download = download;
    this.onError = onError;
    this.jobs = [];
    this.updates = new Map();
    this.lock = Promise.resolve();
    this.worker = null;
    this.controller = null;
    this.running = false;
    this.error = null;
  }

  async init() {
    this.jobs = await this.store.load();
    if (this.jobs.some((job) => job.status === 'downloading')) {
      await this.commit(this.jobs.map((job) => job.status === 'downloading'
        ? { ...job, status: 'queued', progress: null, error: null }
        : job));
    }
  }

  serialized(action) {
    const result = this.lock.then(action);
    this.lock = result.catch(() => {});
    return result;
  }

  async commit(jobs) {
    await this.store.save(jobs);
    this.jobs = jobs;
  }

  list() {
    return structuredClone(this.jobs.map((job) => ({ ...job, ...this.updates.get(job.id) })));
  }

  async enqueue(input) {
    const url = normalizeVideoUrl(input);
    const job = {
      id: randomUUID(), url, title: null, status: 'queued', progress: null,
      filename: null, error: null, createdAt: new Date().toISOString(),
      startedAt: null, finishedAt: null,
    };
    await this.serialized(async () => {
      if (this.error) throw new Error('The queue is unavailable. Check server logs and storage.');
      await this.commit([...this.jobs, job]);
    });
    this.kick();
    return structuredClone(job);
  }

  start() {
    this.running = true;
    this.kick();
  }

  kick() {
    if (!this.running || this.worker || this.error) return;
    this.worker = this.drain().catch((error) => {
      this.error = error;
      this.running = false;
      this.onError(error);
    }).finally(() => {
      this.worker = null;
      if (this.running && this.jobs.some((job) => job.status === 'queued')) this.kick();
    });
  }

  async drain() {
    while (this.running) {
      const job = await this.serialized(async () => {
        if (!this.running) return null;
        const next = this.jobs.find((entry) => entry.status === 'queued');
        if (!next) return null;
        const active = { ...next, status: 'downloading', startedAt: new Date().toISOString() };
        await this.commit(this.jobs.map((entry) => entry.id === active.id ? active : entry));
        return active;
      });
      if (!job) return;

      const controller = new AbortController();
      this.controller = controller;
      let result;
      let failure;
      try {
        if (!this.running) controller.abort();
        controller.signal.throwIfAborted();
        result = await this.download(job, {
          signal: controller.signal,
          onProgress: (update) => this.updates.set(job.id, update),
        });
      } catch (error) {
        failure = error;
      }

      await this.serialized(async () => {
        const metadata = this.updates.get(job.id);
        const interrupted = controller.signal.aborted;
        const finished = {
          ...job,
          title: result?.title ?? metadata?.title ?? job.title,
          status: interrupted ? 'queued' : failure ? 'failed' : 'completed',
          progress: null,
          filename: interrupted ? null : result?.filename ?? null,
          error: interrupted ? null : failure ? String(failure.message || failure).slice(0, 2000) : null,
          finishedAt: interrupted ? null : new Date().toISOString(),
        };
        await this.commit(this.jobs.map((entry) => entry.id === job.id ? finished : entry));
        this.updates.delete(job.id);
      });
      this.controller = null;
    }
  }

  async idle() {
    while (this.worker) await this.worker;
  }

  async stop() {
    this.running = false;
    this.controller?.abort();
    await this.idle();
    await this.lock;
  }
}
