// Dev server proxy (`npm start`): same paths as the nginx container.
//   /api/*        -> FastAPI            (set BACKEND_URL, default http://localhost:8400)
//   /raw/*        -> FastAPI downloads   (nginx serves the /shared mount instead in Docker)
//   /arxiv/*      -> export.arxiv.org
//   /telemetry/*  -> telemetry server
const backend = process.env.BACKEND_URL ?? 'http://localhost:8400';
const telemetry = 'https://telemetryathenacognis.chades.fr';

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
  '/telemetry': { target: telemetry, changeOrigin: true, pathRewrite: { '^/telemetry': '' } },
};
