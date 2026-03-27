FROM node:20-alpine AS builder
WORKDIR /app

ARG API_BASE=http://backend:5000
ARG PUBLIC_SITE_TITLE=My Notes
ARG PUBLIC_SITE_DESCRIPTION=A personal knowledge base

ENV API_BASE=${API_BASE}
ENV PUBLIC_SITE_TITLE=${PUBLIC_SITE_TITLE}
ENV PUBLIC_SITE_DESCRIPTION=${PUBLIC_SITE_DESCRIPTION}

COPY package*.json ./
RUN npm install --legacy-peer-deps

COPY . .
RUN npm run build

# ── Runtime stage ────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app

ENV API_BASE=${API_BASE}
ENV HOST=0.0.0.0
ENV PORT=4321

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules

EXPOSE 4321

CMD ["node", "dist/server/entry.mjs"]
