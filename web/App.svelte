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

  const pending = $derived(jobs.filter((job) => ['queued', 'downloading'].includes(job.status)));
  const history = $derived(jobs.filter((job) => ['completed', 'failed'].includes(job.status)).toReversed());
  const completed = $derived(jobs.filter((job) => job.status === 'completed').length);

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

<div class="shell">
  <header class="header">
    <a href="/" class="brand">
      <span class="brand-mark" aria-hidden="true"></span>
      <span>downloader<span class="brand-dot">.</span></span>
    </a>
    <span class="header-note">Your little video queue</span>
  </header>

  <main>
    <section class="intro" aria-labelledby="page-title">
      <p class="eyebrow">PASTE. QUEUE. SAVE.</p>
      <h1 id="page-title">Good videos.<br />Saved for later<span class="accent">.</span></h1>
      <p class="subtitle">Drop a YouTube link. We’ll take it from here, one video at a time.</p>

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
            {submitting ? 'Adding…' : 'Add to queue'}<span aria-hidden="true">↗</span>
          </button>
        </div>
        <p id="form-message" class:error={Boolean(formError)} class="form-message" aria-live="polite">
          {formError || notice || 'Single videos · Best available quality'}
        </p>
      </form>
    </section>

    {#if connectionError || queueError}
      <p class="connection-error" role="alert">{connectionError || queueError}</p>
    {/if}

    <section class="queue-section" aria-labelledby="queue-title">
      <div class="section-heading">
        <h2 id="queue-title">The queue <span class="count">{pending.length}</span></h2>
        <span class="live-indicator" class:offline={Boolean(connectionError)}>
          <span aria-hidden="true"></span>{connectionError ? 'Reconnecting' : loaded ? 'Updates automatically' : 'Connecting…'}
        </span>
      </div>

      {#if !loaded && !connectionError}
        <div class="empty-state"><p>Loading your queue…</p></div>
      {:else if !pending.length}
        <div class="empty-state">
          <span class="empty-icon" aria-hidden="true">↓</span>
          <h3>Room for something good.</h3>
          <p>Add a video above and it’ll show up here.</p>
        </div>
      {:else}
        <ol class="job-list">
          {#each pending as job, index (job.id)}
            <li class="job" class:active={job.status === 'downloading'}>
              <span class="job-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
              <div class="job-content">
                <a class="job-title" href={job.url} target="_blank" rel="noreferrer">{job.title || job.url}</a>
                <div class="job-detail">{job.title ? job.url : 'Title appears when the download starts'}</div>
                {#if job.status === 'downloading'}
                  <progress
                    max="100"
                    value={job.progress?.stage === 'downloading' ? job.progress.percent ?? undefined : undefined}
                    aria-label="Download progress for current stream"
                  ></progress>
                  <span class="progress-detail">{progressText(job) || 'Getting your video ready…'}</span>
                {/if}
              </div>
              <span class="badge" class:working={job.status === 'downloading'}>{label(job)}</span>
            </li>
          {/each}
        </ol>
      {/if}
    </section>

    {#if history.length}
      <section class="history-section" aria-labelledby="history-title">
        <div class="section-heading">
          <h2 id="history-title">Recently finished</h2>
          <span class="section-note">{completed} saved</span>
        </div>
        <ul class="job-list history-list">
          {#each history as job (job.id)}
            <li class="job">
              <span class="history-icon" class:failed={job.status === 'failed'} aria-hidden="true">{job.status === 'completed' ? '✓' : '!'}</span>
              <div class="job-content">
                <a class="job-title" href={job.url} target="_blank" rel="noreferrer">{job.title || job.url}</a>
                {#if job.error}<p class="job-error">{job.error}</p>
                {:else}<div class="job-detail">{job.filename}</div>{/if}
              </div>
              <span class="badge" class:failed={job.status === 'failed'}>{label(job)}</span>
            </li>
          {/each}
        </ul>
      </section>
    {/if}
  </main>

  <footer><span class="footer-dot" aria-hidden="true"></span>One video at a time. Nice and simple.</footer>
</div>
