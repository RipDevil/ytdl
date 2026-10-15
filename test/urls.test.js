import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeVideoUrl } from '../server/urls.js';
import { firstUrl } from './helpers.js';

test('normalizes supported video URLs and removes playlist and tracking parameters', () => {
  for (const url of [
    `${firstUrl}&list=PL123&index=4&t=60`,
    ' https://youtu.be/abcdefghijk?si=tracking ',
    'https://www.youtube.com/shorts/abcdefghijk',
    'https://youtube.com/live/abcdefghijk',
    'https://m.youtube.com/watch?v=abcdefghijk',
    'http://music.youtube.com/watch?v=abcdefghijk',
    'https://www.youtube.com/embed/abcdefghijk/',
  ]) assert.equal(normalizeVideoUrl(url), firstUrl);
});

test('rejects playlists, other hosts, malformed URLs and credentials', () => {
  for (const url of [
    null, 42, '', 'abcdefghijk', 'https://youtube.com/playlist?list=PL123',
    'https://youtube.com/watch?v=too-short',
    'https://youtube.com.evil.example/watch?v=abcdefghijk',
    'https://example.com/watch?v=abcdefghijk',
    'https://youtube.com@evil.example/watch?v=abcdefghijk',
    'https://user:pass@youtube.com/watch?v=abcdefghijk',
    'ftp://youtube.com/watch?v=abcdefghijk',
    'https://youtube.com:8080/watch?v=abcdefghijk',
    'https://youtu.be/abcdefghijk/extra',
    `https://youtube.com/watch?v=abcdefghijk&x=${'a'.repeat(2048)}`,
  ]) assert.throws(() => normalizeVideoUrl(url));
});
