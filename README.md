# SimpleVoiceChat

Простой голосовой чат для общения в браузере. Одна общая комната, без регистрации и установки дополнительного ПО.

## Features

- Общая голосовая комната.
- Подключение без регистрации.
- WebRTC для передачи аудио напрямую между участниками.
- Opus audio codec.
- Echo cancellation и noise suppression.
- STUN/TURN для установления соединений за NAT.
- HTTPS и WebSocket.
- Поддержка до 12 участников.

## Architecture

Проект состоит из трёх основных компонентов:

| Компонент | Технологии | Назначение |
|---|---|---|
| `server/` | Rust, Axum | HTTP-сервер и WebSocket-сигнализация |
| `client/` | React, TypeScript, Vite | Пользовательский интерфейс и WebRTC |
| `docker-compose.yml` | Docker, Caddy, coturn | Развёртывание и TURN-инфраструктура |

### Connection flow

```text
                 HTTPS / WebSocket
Browser A ───────────────┐
                         ▼
                       Caddy
                         │
                         ▼
                    Rust / Axum
                    Signaling
                         ▲
                         │
Browser B ───────────────┘

Browser A ◄──────── WebRTC ────────► Browser B
                  Audio (Opus)

              └── coturn (TURN)
                  Fallback relay
```

Сигнальный сервер используется только для обмена данными, необходимыми для установления WebRTC-соединения. Аудиопоток передаётся напрямую между участниками либо через TURN при невозможности прямого соединения.

## Requirements

Для самостоятельного развёртывания необходимы:

- Linux-сервер с публичным IPv4-адресом.
- Docker и Docker Compose.
- Доменное имя с возможностью управления DNS-записями.
- Открытые сетевые порты для HTTPS и TURN.

## Deployment

### 1. DNS

Добавьте A-запись для домена:

```dns
voice    IN    A    <SERVER_IP>
```

При наличии IPv6 можно дополнительно настроить AAAA-запись.

Проверьте DNS:

```bash
dig +short voice.elysiac.fun
```

### 2. Firewall

Необходимо открыть следующие порты:

| Порт | Протокол | Назначение |
|---|---|---|
| 80 | TCP | Let's Encrypt |
| 443 | TCP/UDP | HTTPS / HTTP3 |
| 3478 | TCP/UDP | TURN |
| 49152–49252 | UDP | TURN relay |

### 3. Environment

Клонируйте репозиторий и создайте конфигурацию:

```bash
git clone git@github.com:Foksif/SimpleVoiceChat.git
cd SimpleVoiceChat

cp .env.example .env
```

Настройте `.env`:

```env
SERVER_IP=<PUBLIC_IPV4>
TURN_USER=voice
TURN_PASSWORD=<TURN_PASSWORD>
```

Сгенерировать пароль можно командой:

```bash
openssl rand -hex 16
```

`TURN_USER` и `TURN_PASSWORD` используются для аутентификации на TURN-сервере.

### 4. Start

Запустите проект:

```bash
docker compose up -d --build
```

Caddy автоматически получит TLS-сертификат для настроенного домена.

После запуска приложение будет доступно по адресу:

https://voice.elysiac.fun

## Development

Для локальной разработки используется Nix.

```bash
nix-shell --run fish
```

Запустите сервер:

```bash
cd server
cargo run
```

Сервер будет доступен на `localhost:3001`.

В отдельном терминале запустите клиент:

```bash
cd client
npm install
npm run dev
```

Vite запускается на `localhost:1420`. WebSocket-запросы `/ws` проксируются на Rust-сервер.

### Production build

Сначала соберите клиент:

```bash
cd client
npm install
npm run build
```

Затем запустите сервер:

```bash
cd ../server
cargo run --release
```

Приложение будет доступно на `http://localhost:3001`.

## Maintenance

Обновление проекта:

```bash
git pull
docker compose up -d --build
```

Просмотр логов:

```bash
docker compose logs -f
```

Логи Caddy:

```bash
docker compose logs -f caddy
```

Остановка:

```bash
docker compose down
```

При изменении `.env` необходимо пересобрать контейнеры, поскольку параметры TURN также используются при сборке клиента.

## Limitations

- Используется Mesh-топология: каждый участник устанавливает отдельное соединение с каждым остальным участником.
- Максимальное количество участников — 12.
- Рекомендуемое количество участников — 6–8.
- TURN credentials включены в клиентскую сборку и доступны пользователям приложения.
- Автоматическое переподключение после потери соединения не реализовано.

## License

Укажите лицензию проекта в соответствии с выбранной лицензией репозитория.
