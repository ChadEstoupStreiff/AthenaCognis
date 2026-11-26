# AthenaCognis front: Angular build served by nginx (static files + /api proxy, no app server).
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# npm download cache kept across builds: a package change only fetches new tarballs.
RUN --mount=type=cache,target=/root/.npm npm ci
COPY . .
# Angular build cache kept across builds: unchanged files are not recompiled.
RUN --mount=type=cache,target=/app/.angular/cache npm run build

FROM nginx:1.28-alpine
ENV BACKEND_HOST=back:80 \
    GROBID_HOST=grobid:8070
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist/web/browser /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO /dev/null http://127.0.0.1/ || exit 1
