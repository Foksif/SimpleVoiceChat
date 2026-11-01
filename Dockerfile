# ---- сайт (React) ----
FROM node:22-slim AS web
WORKDIR /web
COPY client/package*.json ./
RUN npm install
COPY client .
# STUN/TURN вшиваются в клиент при сборке
ARG VITE_ICE_SERVERS=""
ENV VITE_ICE_SERVERS=$VITE_ICE_SERVERS
RUN npm run build

# ---- сервер (Rust) ----
FROM rust:1-slim AS server
WORKDIR /app
COPY server .
RUN cargo build --release

# ---- итоговый образ ----
FROM debian:stable-slim
COPY --from=server /app/target/release/voice-server /usr/local/bin/voice-server
COPY --from=web /web/dist /app/dist
ENV PORT=3001 STATIC_DIR=/app/dist
EXPOSE 3001
CMD ["voice-server"]
