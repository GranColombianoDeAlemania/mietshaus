# Mietshaus server for the NAS (Synology Container Manager or any Docker host).
# Build: docker build -t mietshaus .   Run: see compose.yaml and ANLEITUNG-NAS.md.

# ---- user interface ----
FROM node:24-bookworm-slim AS oberflaeche
WORKDIR /app
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY index.html vite.config.mts tsconfig.json ./
COPY src ./src
COPY electron ./electron
RUN npx vite build

# ---- server ----
FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production MIETSHAUS_DATEN=/daten PORT=8080 HOST=0.0.0.0 TZ=Europe/Berlin
COPY package.json package-lock.json ./
# Only what the server needs at run time (pdf.js, canvas for scans, Tesseract, mail, MCP); no Electron.
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY electron ./electron
COPY server ./server
COPY resources/tessdata ./resources/tessdata
COPY --from=oberflaeche /app/dist ./dist
RUN mkdir -p /daten /eingang && chown node:node /daten /eingang
USER node
VOLUME ["/daten"]
EXPOSE 8080
HEALTHCHECK --interval=60s --timeout=5s --start-period=30s CMD node -e "fetch('http://127.0.0.1:8080/api/status').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "server/server.cjs"]
