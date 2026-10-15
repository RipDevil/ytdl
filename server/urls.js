const videoId = /^[a-zA-Z0-9_-]{11}$/;
const hosts = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com']);

export function normalizeVideoUrl(input) {
  if (typeof input !== 'string' || input.length > 2048) {
    throw new Error('Enter a valid YouTube video URL.');
  }

  let url;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error('Enter a valid YouTube video URL.');
  }

  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) {
    throw new Error('Enter an HTTP or HTTPS YouTube video URL.');
  }

  let id;
  if (url.hostname === 'youtu.be' || url.hostname === 'www.youtu.be') {
    id = url.pathname.match(/^\/([^/]+)\/?$/)?.[1];
  } else if (hosts.has(url.hostname)) {
    if (url.pathname === '/watch') id = url.searchParams.get('v');
    else id = url.pathname.match(/^\/(?:shorts|live|embed)\/([^/]+)\/?$/)?.[1];
  }

  if (!videoId.test(id ?? '')) {
    throw new Error('Use a link to one YouTube video. Playlist-only links are not supported.');
  }

  return `https://www.youtube.com/watch?v=${id}`;
}
