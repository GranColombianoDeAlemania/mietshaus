# Mietshaus server for the NAS (Synology Container Manager or any Docker host).
# Build: docker build -t mietshaus .   Run: see compose.yaml and ANLEITUNG-NAS.md.

# ---- user interface ----
FROM node:24-bookworm-slim AS oberflaeche
WORKDIR /app
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY index.html vite.config.mts tsconfig.json ./
COPY public ./public
COPY src ./src
COPY electron ./electron
# Logo, icons, manifest and service worker come from public/; without them the page shows no logo and push stays off.
RUN npx vite build && test -f dist/logo.svg && test -f dist/symbole/cockpit.svg && test -f dist/sw.js && test -f dist/manifest.webmanifest

# ---- server ----
FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production MIETSHAUS_DATEN=/daten PORT=8080 HOST=0.0.0.0 TZ=Europe/Berlin
COPY package.json package-lock.json ./
# Only what the server needs at run time (pdf.js, canvas for scans, Tesseract, mail, MCP); no Electron.
# The image model's runtime (local image search) ships builds for every system; only this one's stays (~23 MB).
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force \
 && arch=$(uname -m | sed 's/x86_64/x64/;s/aarch64/arm64/') \
 && find node_modules/onnxruntime-node/bin -mindepth 2 -maxdepth 2 ! -name linux -exec rm -rf {} + \
 && find node_modules/onnxruntime-node/bin/*/linux -mindepth 1 -maxdepth 1 ! -name "$arch" -exec rm -rf {} + \
 && test -f node_modules/onnxruntime-node/bin/napi-v6/linux/$arch/onnxruntime_binding.node
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
