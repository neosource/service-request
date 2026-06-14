FROM docker.io/library/node:20-bookworm-slim

WORKDIR /app

# Install only production deps first for cache reuse.
COPY backend/package.json ./
RUN npm install --omit=dev

# Copy backend source.
COPY backend/src ./src
COPY backend/.env ./
# Copy frontend into the public dir so the API can serve the SPA.
COPY frontend ./public

ENV NODE_ENV=production

ENV PORT=3000

EXPOSE 3000

CMD ["node", "src/server.js"]
