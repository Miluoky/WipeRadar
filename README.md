# WipeRadar

Трекер вайпов и мониторинг серверов Rust на 10 языках: EN, RU, UK, DE, PL, FR, ES, PT-BR, TR, ZH. План, архитектура и роадмап — в [PLAN.md](PLAN.md).

```
packages/shared    TypeScript — типы, парсер keywords Rust, классификация, глобальный вайп, прогнозы
packages/a2s       TypeScript — клиент Valve Server Query (INFO/RULES/PLAYER) + фейковый сервер для тестов
services/prober    Rust      — высокопроизводительный A2S-пробер: один UDP-сокет на все серверы, HTTP API
apps/worker        TypeScript — поллер Steam → детект вайпов → Postgres/PGlite, Fastify API + SSE
apps/web           TypeScript — Next.js 16: главная, карточка сервера, календарь, OG-картинки, sitemap
```

## Быстрый старт (без Docker и без ключей)

```bash
npm install
```

```bash
npm run dev
```

Откройте http://localhost:3000. Команда поднимает воркер, сайт и, если установлен Rust, пробер (первая сборка около минуты).

- С `STEAM_API_KEY` в `apps/worker/.env` — реальные серверы (около 11 тыс.).
- Без ключа — **демо-режим**: 63 вымышленных сервера, 30 дней истории, живые вайпы каждые 1–3 минуты.
- База — встроенный PGlite (путь `PGLITE_DIR`, по умолчанию `apps/worker/data`; удалите папку, чтобы сбросить данные).
- Регионы — база DB-IP Lite (`GEOIP_DB`), скачивается бесплатно: https://db-ip.com/db/download/ip-to-country-lite (атрибуция «IP Geolocation by DB-IP» уже стоит в футере).

## Rust-пробер

Нужен тулчейн Rust (`rustup`). Запуск на `127.0.0.1:4100`:

```bash
npm run prober
```

Затем укажите в `apps/worker/.env` строку `PROBER_URL=http://127.0.0.1:4100`: воркер начнёт отдавать опрос RULES пачками в Rust-сервис. Без этой переменной опрос идёт из Node.

Проверить один сервер:

```bash
cargo run --release --manifest-path services/prober/Cargo.toml -- query 1.2.3.4:28017
```

Нагрузочный тест: 500 фейковых серверов через запущенный пробер.

```bash
npx tsx apps/worker/src/tools/prober-bench.ts 500
```

> Если линкер MSVC пишет `LNK1104: cannot open file`, задайте `CARGO_TARGET_DIR` вне синхронизируемых или виртуализированных папок, например `%TEMP%\wr-target`.

## Реальные данные

1. Получите ключ: https://steamcommunity.com/dev/apikey
2. Укажите его в `apps/worker/.env`: `STEAM_API_KEY=...`
3. Сверьте теги Rust с парсером:

```bash
npm run tags:survey -w @wiperadar/worker
```

### Прокси / VPN

Если Steam API доступен только через локальный прокси (например, v2rayN на `127.0.0.1:10809`), воркер сам использует `HTTPS_PROXY` / `HTTP_PROXY` из окружения. UDP-опрос серверов (A2S) идёт напрямую.

### База на Windows + OneDrive

Проект лежит в синхронизируемой папке, поэтому живая база вынесена из неё: в `apps/worker/.env` задано `PGLITE_DIR=C:/Users/<you>/AppData/Local/WipeRadar/pglite`.

## Продакшен

```bash
docker compose up -d --build
```

Поднимает TimescaleDB, Rust-пробер, worker и web на порту 3000. Переменные: `STEAM_API_KEY`, `POSTGRES_PASSWORD`, `GEOIP_DB`, `SITE_URL` (для sitemap и OG).

## Тесты

```bash
npm test
```

```bash
npm run prober:test
```
