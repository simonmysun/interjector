# syntax=docker/dockerfile:1

# --- Build stage -------------------------------------------------------------
# Bundles the frontend and backend into a self-contained ./dist directory.
FROM node:22-alpine AS build

WORKDIR /app

# Install dependencies with a clean, reproducible install (build tools like
# esbuild/typescript live in devDependencies, so we need the full install).
COPY package.json package-lock.json ./
RUN npm ci

# Build the frontend + backend bundles into ./dist.
COPY tsconfig.json ./
COPY shared ./shared
COPY backend ./backend
COPY frontend ./frontend
RUN npm run build

# --- Runtime stage -----------------------------------------------------------
# The backend bundle only uses Node.js built-in modules, so the runtime image
# needs nothing beyond the compiled ./dist output.
FROM node:22-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app

# Run as the non-root user that ships with the node image.
COPY --chown=node:node --from=build /app/dist ./dist
USER node

# Default to plain HTTP on 0.0.0.0:8000; TLS is expected to be handled by a
# reverse proxy. Override any of these at runtime via `-e` / `--env-file`.
ENV PORT=8000 \
    HOST=0.0.0.0 \
    HTTP_ONLY=true

EXPOSE 8000

WORKDIR /app/dist
CMD ["node", "server.bundle.js"]
