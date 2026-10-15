import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { normalizeVideoUrl } from './urls.js';

export function buildApp({ queue, serveFrontend = true, logger = true }) {
  const app = Fastify({ logger, bodyLimit: 4096, requestTimeout: 15000 });

  app.get('/api/health', async (_request, reply) => {
    if (queue.error) return reply.code(503).send({ status: 'error' });
    return { status: 'ok' };
  });

  app.get('/api/jobs', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return { jobs: queue.list(), queueError: queue.error ? 'Queue paused: check server logs and storage.' : null };
  });

  app.post('/api/jobs', {
    schema: {
      body: {
        type: 'object', required: ['url'], additionalProperties: false,
        properties: { url: { type: 'string', minLength: 1, maxLength: 2048 } },
      },
    },
  }, async (request, reply) => {
    let url;
    try {
      url = normalizeVideoUrl(request.body.url);
    } catch (error) {
      return reply.code(400).send({ error: error.message });
    }
    try {
      const job = await queue.enqueue(url);
      return reply.code(201).send({ job });
    } catch (error) {
      request.log.error(error);
      return reply.code(503).send({ error: 'Could not save the job. Check server logs and storage, then try again.' });
    }
  });

  app.setErrorHandler((error, request, reply) => {
    if (error.validation) return reply.code(400).send({ error: 'Provide a JSON object with a YouTube video URL.' });
    if (error.statusCode && error.statusCode < 500) {
      return reply.code(error.statusCode).send({ error: error.message });
    }
    request.log.error(error);
    return reply.code(500).send({ error: 'An unexpected server error occurred.' });
  });

  if (serveFrontend) {
    app.register(fastifyStatic, { root: fileURLToPath(new URL('../dist/', import.meta.url)) });
  }
  app.addHook('onClose', () => queue.stop());
  return app;
}
