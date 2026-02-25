FROM node:20-alpine AS deps

WORKDIR /app

COPY package*.json ./
RUN npm ci


FROM node:20-alpine AS builder

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package*.json tsconfig.json ./
COPY api ./api
COPY src ./src

RUN npm run build


FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/dist ./dist

RUN npm ci --omit=dev --ignore-scripts

EXPOSE 8787

CMD ["node", "dist/src/server.js"]
