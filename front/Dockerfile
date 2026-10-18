# AthenaCognis front: Angular build served by nginx (static files + /api proxy, no app server).
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.28-alpine
ENV BACKEND_HOST=back:80 \
    GROBID_HOST=grobid:8070 \
    TELEMETRY_UPSTREAM=""
COPY nginx/15-athena-env.envsh /docker-entrypoint.d/15-athena-env.envsh
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY nginx/40-athena-config.sh /docker-entrypoint.d/40-athena-config.sh
COPY --from=build /app/dist/web/browser /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO /dev/null http://127.0.0.1/ || exit 1
