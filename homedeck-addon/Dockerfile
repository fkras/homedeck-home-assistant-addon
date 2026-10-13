# Home Assistant builds this image on its own machine at every update, so it
# only installs the server's four runtime packages and copies files in. The
# frontend arrives built, in web/dist: bundling the editor needs ~1 GB of RAM,
# and on an HA box that meant swapping for 20+ minutes per update.
FROM oven/bun:1.2.9

WORKDIR /app/web

COPY web/package.json web/bun.lock ./
RUN bun install --frozen-lockfile --production

COPY web/server.ts ./
COPY web/dist ./dist

EXPOSE 4663

CMD ["bun", "run", "server.ts"]
