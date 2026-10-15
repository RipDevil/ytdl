import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

export const firstUrl = 'https://www.youtube.com/watch?v=abcdefghijk';
export const secondUrl = 'https://www.youtube.com/watch?v=lmnopqrstuv';

export async function temporaryDirectory(t) {
  const base = resolve('.tmp');
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(resolve(base, 'unit-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

export function memoryStore(initial = []) {
  let saved = structuredClone(initial);
  return {
    load: async () => structuredClone(saved),
    save: async (jobs) => { saved = structuredClone(jobs); },
  };
}
