import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

const statuses = new Set(['queued', 'downloading', 'completed', 'failed']);

export class JsonStore {
  constructor(filename) {
    this.filename = filename;
  }

  async load() {
    let text;
    try {
      text = await readFile(this.filename, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }

    const data = JSON.parse(text);
    const ids = new Set();
    if (data.version !== 1 || !Array.isArray(data.jobs) || data.jobs.some((job) => {
      if (!job || typeof job.id !== 'string' || ids.has(job.id)
        || typeof job.url !== 'string' || !statuses.has(job.status)) return true;
      ids.add(job.id);
      return false;
    })) {
      throw new Error('Invalid queue state. Restore the queue file from a backup before starting.');
    }
    return data.jobs;
  }

  async save(jobs) {
    await mkdir(dirname(this.filename), { recursive: true });
    const temporary = `${this.filename}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify({ version: 1, jobs }, null, 2), { mode: 0o600 });
      await rename(temporary, this.filename);
    } finally {
      await unlink(temporary).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
  }
}
