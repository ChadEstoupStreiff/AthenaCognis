// Dev server proxy (`npm start`): same paths as the nginx container.
//   /api/*        -> FastAPI            (set BACKEND_URL, default http://localhost:8400)
//   /raw/*        -> FastAPI downloads   (nginx serves the /shared mount instead in Docker)
//   /arxiv/*      -> export.arxiv.org
//   /telemetry/*  -> TELEMETRY_SERVER_URL (only when set)
const backend = process.env.BACKEND_URL ?? 'http://localhost:8400';
const telemetry = (process.env.TELEMETRY_SERVER_URL ?? '').replace(/\/$/, '');

export default {
  '/api': { target: backend, changeOrigin: true, pathRewrite: { '^/api': '' } },
  '/raw': {
    target: backend,
    changeOrigin: true,
    pathRewrite: { '^/raw': '/files/download//shared' },
  },
  '/arxiv': {
    target: 'https://export.arxiv.org',
    changeOrigin: true,
    secure: true,
    pathRewrite: { '^/arxiv': '' },
  },
  ...(telemetry
    ? {
        '/telemetry': { target: telemetry, changeOrigin: true, pathRewrite: { '^/telemetry': '' } },
      }
    : {}),
};
