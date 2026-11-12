FROM node:24.22.3-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54 AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS build
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN BOSSOB_STANDALONE=1 npm run build

FROM base
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
# Next traces the web server only. The worker and migrations run directly.
COPY --from=build --chown=node:node /app/node_modules/drizzle-orm ./node_modules/drizzle-orm
COPY --from=build --chown=node:node /app/node_modules/nodemailer ./node_modules/nodemailer
COPY --from=build --chown=node:node /app/db/migrations ./db/migrations
COPY --from=build --chown=node:node /app/db/migrate.ts /app/db/grant-admin.ts ./db/
COPY --from=build --chown=node:node /app/notifications/worker.ts /app/notifications/transport.ts /app/notifications/policy.ts ./notifications/
COPY --from=build --chown=node:node /app/deploy/entrypoint.sh ./deploy/entrypoint.sh
RUN install -d -o node -g node -m 0700 /var/lib/bossob/attachments
USER node
ENTRYPOINT ["/bin/sh", "/app/deploy/entrypoint.sh"]
CMD ["node", "server.js"]
