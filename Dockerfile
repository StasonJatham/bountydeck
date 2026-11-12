FROM node:26.13.1-alpine@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5 AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS build
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN BOUNTYDECK_STANDALONE=1 npm run build

FROM base
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
RUN rm -r /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
    && find /usr -xdev -type f \( -perm -4000 -o -perm -2000 \) -exec chmod a-s {} + \
    && install -d -o 1000 -g 1000 -m 0700 /var/lib/bountydeck/attachments
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
# Next traces the web server only. The worker and migrations run directly.
COPY --from=build /app/node_modules/drizzle-orm ./node_modules/drizzle-orm
COPY --from=build /app/node_modules/nodemailer ./node_modules/nodemailer
COPY --from=build /app/db/migrations ./db/migrations
COPY --from=build /app/lib/telemetry/logger.ts ./lib/telemetry/logger.ts
COPY --from=build /app/db/migrate.ts /app/db/grant-admin.ts /app/db/provision-integration.ts /app/db/reconcile-achievements.ts ./db/
COPY --from=build /app/notifications/worker.ts /app/notifications/transport.ts /app/notifications/policy.ts ./notifications/
COPY --from=build /app/deploy/entrypoint.sh /app/deploy/retention.ts ./deploy/
USER 1000:1000
ENTRYPOINT ["/bin/sh", "/app/deploy/entrypoint.sh"]
CMD ["node", "server.js"]
