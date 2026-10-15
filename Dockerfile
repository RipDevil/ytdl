FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV YOUTUBE_DL_SKIP_DOWNLOAD=true
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY web ./web
COPY vite.config.js ./
RUN npm run build && npm prune --omit=dev && rm -rf .cache

FROM node:24-bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv ffmpeg ca-certificates \
    && python3 -m venv /opt/yt-dlp \
    && /opt/yt-dlp/bin/pip install --no-cache-dir 'yt-dlp[default]' \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    DOWNLOADS_DIR=/downloads \
    DATA_DIR=/data \
    YT_DLP_PATH=/opt/yt-dlp/bin/yt-dlp
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY server ./server
RUN mkdir /downloads /data && chown node:node /downloads /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
    CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/api/health').then(r => { if (!r.ok) process.exit(1); }).catch(() => process.exit(1))"
CMD ["node", "server/index.js"]
