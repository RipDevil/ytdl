<script>
  import { onMount } from 'svelte';

  let url = $state('');
  let jobs = $state([]);
  let submitting = $state(false);
  let loaded = $state(false);
  let formError = $state('');
  let connectionError = $state('');
  let queueError = $state('');
  let notice = $state('');
  let lifetime;
  let revision = 0;

  function requestSignal() {
    return AbortSignal.any([lifetime.signal, AbortSignal.timeout(10000)]);
  }

  async function refresh() {
    const current = ++revision;
    try {
      const response = await fetch('/api/jobs', { signal: requestSignal(), cache: 'no-store' });
      if (!response.ok) throw new Error('Queue unavailable');
      const data = await response.json();
      if (current !== revision || lifetime.signal.aborted) return;
      jobs = data.jobs;
      queueError = data.queueError || '';
      connectionError = '';
      loaded = true;
    } catch {
      if (current === revision && !lifetime.signal.aborted) {
        connectionError = 'Cannot reach the server. Reconnecting automatically…';
      }
    }
  }

  onMount(() => {
    lifetime = new AbortController();
    let timer;
    async function poll() {
      await refresh();
      if (!lifetime.signal.aborted) timer = setTimeout(poll, 2000);
    }
    poll();
    return () => {
      lifetime.abort();
      clearTimeout(timer);
    };
  });

  async function submit(event) {
    event.preventDefault();
    if (submitting) return;
    submitting = true;
    formError = '';
    notice = '';
    try {
      const response = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
        signal: requestSignal(),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not add this video.');
      url = '';
      notice = 'Video added to the queue.';
      await refresh();
    } catch (error) {
      formError = error.name === 'TypeError' || error.name === 'TimeoutError'
        ? 'Could not confirm submission. Check the queue before trying again.'
        : error.message;
    } finally {
      submitting = false;
    }
  }

  function label(job) {
    if (job.status === 'queued') return 'Waiting';
    if (job.status === 'completed') return 'Saved';
    if (job.status === 'failed') return 'Failed';
    if (job.progress?.stage === 'processing') return 'Merging';
    if (job.progress?.stage === 'preparing' || !job.progress) return 'Preparing';
    return 'Downloading';
  }

  function progressText(job) {
    const progress = job.progress;
    if (!progress || progress.stage !== 'downloading') return '';
    const parts = [];
    if (progress.percent !== null) parts.push(`${Math.round(progress.percent)}% of current stream`);
    if (progress.speed) parts.push(`${(progress.speed / 1024 / 1024).toFixed(1)} MB/s`);
    return parts.join(' · ');
  }
</script>

<svelte:head><title>Video queue</title></svelte:head>

<main class="shell">
  <form onsubmit={submit} class="add-form">
    <label for="video-url">YouTube video link</label>
    <div class="input-row">
      <input
        id="video-url"
        type="url"
        bind:value={url}
        placeholder="https://www.youtube.com/watch?v=…"
        required
        maxlength="2048"
        autocomplete="off"
        spellcheck="false"
        aria-invalid={formError ? 'true' : undefined}
        aria-describedby="form-message"
      />
      <button type="submit" disabled={submitting || !url.trim()}>
        {submitting ? 'Adding…' : 'Add to queue'}
      </button>
    </div>
    <p id="form-message" class:error={Boolean(formError)} class="form-message" aria-live="polite">
      {formError || notice}
    </p>
  </form>

  {#if connectionError || queueError}
    <p class="connection-error" role="alert">{connectionError || queueError}</p>
  {/if}

  <section class="queue-section" aria-labelledby="queue-title">
    <div class="section-heading">
      <h1 id="queue-title">Queue <span class="count">{jobs.length}</span></h1>
    </div>

    {#if !loaded && !connectionError}
      <div class="empty-state"><p>Loading queue…</p></div>
    {:else if loaded && !jobs.length}
      <div class="empty-state"><p>Queue is empty.</p></div>
    {:else if jobs.length}
      <ol class="job-list">
        {#each jobs as job, index (job.id)}
          <li class="job" class:active={job.status === 'downloading'}>
            <span class="job-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
            <div class="job-content">
              <a class="job-title" href={job.url} target="_blank" rel="noreferrer">{job.title || job.url}</a>
              {#if job.error}
                <p class="job-error">{job.error}</p>
              {:else if job.filename}
                <div class="job-detail">{job.filename}</div>
              {/if}
              {#if job.status === 'downloading'}
                <progress
                  max="100"
                  value={job.progress?.stage === 'downloading' ? job.progress.percent ?? undefined : undefined}
                  aria-label="Download progress for current stream"
                ></progress>
                <span class="progress-detail">{progressText(job) || label(job)}</span>
              {/if}
            </div>
            <span class="badge" class:working={job.status === 'downloading'} class:failed={job.status === 'failed'}>{label(job)}</span>
          </li>
        {/each}
      </ol>
    {/if}
  </section>
</main>
