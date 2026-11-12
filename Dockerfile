FROM node:26.13.1-trixie-slim@sha256:e6bedef217677b276c591795e169840edd9096dbf13f29df8ef8d1856b8820bc AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS build
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN BOUNTYDECK_STANDALONE=1 npm run build

FROM base
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
# Next traces the web server only. The worker and migrations run directly.
COPY --from=build --chown=node:node /app/node_modules/drizzle-orm ./node_modules/drizzle-orm
COPY --from=build --chown=node:node /app/node_modules/nodemailer ./node_modules/nodemailer
COPY --from=build --chown=node:node /app/db/migrations ./db/migrations
COPY --from=build --chown=node:node /app/lib/telemetry/logger.ts ./lib/telemetry/logger.ts
COPY --from=build --chown=node:node /app/db/migrate.ts /app/db/grant-admin.ts /app/db/provision-integration.ts /app/db/reconcile-achievements.ts ./db/
COPY --from=build --chown=node:node /app/notifications/worker.ts /app/notifications/transport.ts /app/notifications/policy.ts ./notifications/
COPY --from=build --chown=node:node /app/deploy/entrypoint.sh /app/deploy/retention.ts ./deploy/
RUN install -d -o node -g node -m 0700 /var/lib/bountydeck/attachments
USER node
ENTRYPOINT ["/bin/sh", "/app/deploy/entrypoint.sh"]
CMD ["node", "server.js"]
