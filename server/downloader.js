import { mkdir } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { createInterface } from 'node:readline';
import youtubeDl from 'youtube-dl-exec';

const PREFIX = '__TOMATO_';

function number(value) {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value).trim());
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function parseOutput(line) {
  if (!line.startsWith(PREFIX)) return null;
  const match = line.match(/^__TOMATO_(META|PROGRESS|FILE)__(.*)$/);
  if (!match) return null;
  try {
    const value = JSON.parse(match[2]);
    if (match[1] === 'META' && typeof value === 'string') return { title: value };
    if (match[1] === 'FILE' && typeof value === 'string') return { filename: value };
    if (match[1] === 'PROGRESS' && value && typeof value === 'object') {
      const percent = number(value.percent);
      return { progress: {
        stage: value.stage === 'processing' ? 'processing' : 'downloading',
        percent: percent === null ? null : Math.min(100, percent),
        speed: number(value.speed), eta: number(value.eta),
      } };
    }
  } catch {
    // Ignore malformed or partial output; yt-dlp can emit ordinary diagnostic lines too.
  }
  return null;
}

export function createDownloader({ downloadsDir, binaryPath = 'yt-dlp', exec }) {
  const directory = resolve(downloadsDir);
  const run = exec ?? youtubeDl.create(binaryPath).exec;

  return async function download(job, { signal, onProgress }) {
    signal.throwIfAborted();
    await mkdir(directory, { recursive: true });
    signal.throwIfAborted();
    const child = run(job.url, {
      ignoreConfig: true,
      noCacheDir: true,
      noPlaylist: true,
      noSimulate: true,
      format: 'bv*+ba/b',
      paths: directory,
      output: '%(title).180B [%(id)s].%(ext)s',
      continue: true,
      noOverwrites: true,
      newline: true,
      progress: true,
      progressDelta: 1,
      jsRuntimes: 'node',
      print: [
        'before_dl:__TOMATO_META__%(title)j',
        'after_move:__TOMATO_FILE__%(filepath)j',
      ],
      progressTemplate: [
        'download:__TOMATO_PROGRESS__{"stage":"downloading","percent":%(progress._percent_str)j,"speed":%(progress.speed)j,"eta":%(progress.eta)j}',
        'postprocess:__TOMATO_PROGRESS__{"stage":"processing"}',
      ],
    }, { detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });

    let title = null;
    let filename = null;
    let progress = { stage: 'preparing', percent: null, speed: null, eta: null };
    let diagnostics = '';
    let killTimer;
    const readers = [];
    onProgress({ title, progress });

    function handleLine(line, isError) {
      const parsed = parseOutput(line);
      if (parsed) {
        if (parsed.title !== undefined) title = parsed.title;
        if (parsed.filename !== undefined) filename = parsed.filename;
        if (parsed.progress) progress = parsed.progress;
        onProgress({ title, progress });
      } else if (isError) {
        diagnostics = `${diagnostics}${line}\n`.slice(-16000);
      }
    }

    for (const [stream, isError] of [[child.stdout, false], [child.stderr, true]]) {
      const reader = createInterface({ input: stream });
      reader.on('line', (line) => handleLine(line, isError));
      readers.push(reader);
    }

    function kill(signalName) {
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signalName);
        else child.kill(signalName);
      } catch (error) {
        if (error.code !== 'ESRCH') child.kill(signalName);
      }
    }

    function abort() {
      kill('SIGTERM');
      killTimer = setTimeout(() => kill('SIGKILL'), 5000);
      killTimer.unref();
    }

    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    try {
      await child;
      signal.throwIfAborted();
      if (!filename) throw new Error('The downloader did not report a completed file.');
      const local = relative(directory, resolve(directory, filename));
      if (!local || local === '..' || local.startsWith(`..${sep}`) || isAbsolute(local)) {
        throw new Error('The downloader reported a file outside the downloads directory.');
      }
      return { title, filename: local };
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      throw new Error(diagnostics.trim() || error.message || 'Download failed.', { cause: error });
    } finally {
      signal.removeEventListener('abort', abort);
      clearTimeout(killTimer);
      for (const reader of readers) reader.close();
    }
  };
}
