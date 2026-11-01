# Voice Room

Голосовой чат с одной общей комнатой, без авторизации. Работает в браузере.

- `server/` — Rust (axum): раздаёт сайт и сигналинг (`/ws`). Звук через него не идёт.
- `client/` — React + TypeScript (Vite). Звук — WebRTC напрямую между участниками.

## Деплой на сервер (voice.elysiac.fun)

1. DNS: A-запись `voice.elysiac.fun` → IP сервера (если домен в Cloudflare — режим «DNS only», серое облако).
2. Файрвол сервера: `80/tcp`, `443/tcp`, `443/udp`, `3478/tcp`, `3478/udp`, `49152-49252/udp`.
3. На сервере (нужен Docker):
```bash
git clone <ваш репозиторий> voice-room && cd voice-room   # или scp/rsync папки
cp .env.example .env && nano .env                          # SERVER_IP, пароль TURN
docker compose up -d --build
```
Через минуту: https://voice.elysiac.fun

Обновление: `git pull && docker compose up -d --build`. Логи: `docker compose logs -f`.

## Локально (Nix)
```bash
nix-shell --run fish
cd client && npm install && npm run build && cd ..
cd server && cargo run --release        # http://localhost:3001
```
Dev: `cargo run` в `server/` и `npm run dev` в `client/` → http://localhost:1420.

## Важно знать
- Mesh: каждый соединён с каждым (лимит 12, комфортно до 6–8).
- TURN-логин/пароль вшиты в клиент, не публикуйте ссылку публично.
