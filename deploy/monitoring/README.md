# Мониторинг нагрузки panzers (прод)

Отдельный долгоживущий стек — **только прод**, НЕ деплоится app-пайплайном. Собирает
нагрузку контейнеров и хоста; наружу отдаётся через app-Caddy на `grafana.panzers.tg`.

```
cadvisor ─┐
node-exp ─┼─► victoriametrics ─► grafana ──(сеть panzers-edge)──► app-Caddy ─► grafana.panzers.tg
          │     (скрейп+хранение)   (дашборд)
```

- **cadvisor** — CPU/RAM/сеть/диск **по каждому контейнеру** (нагрузка на под).
- **node-exporter** — хост: CPU/RAM/диск/load average.
- **victoriametrics** — скрейп обоих + хранение (retention 30д).
- **grafana** — дашборд «Panzers — Нагрузка» (провижинится автоматически: датасорс +
  дашборд). Портов на хост НЕ публикует — доступ только через Caddy.

> ⚠️ App-метрики (RPS, бои, WS-сокеты) тут НЕ собираются: сервер не инструментирован
> (`/metrics` нет). Это отдельная задача — добавить экспортёр в сервер.

## Установка (на прод-сервере, один раз — на cutover, ПОСЛЕ app-стека)

Мониторинг подключается к сети app-стека `panzers_edge` (её создаёт app-compose) —
поэтому сначала должен быть поднят прод app-стек, потом этот стек.

1. Проверить, что сеть app-стека есть:
   ```bash
   docker network inspect panzers_edge >/dev/null && echo ok   # app-стек должен быть поднят
   ```
2. Файлы и .env:
   ```bash
   cd /opt/panzers-monitoring
   cp .env.example .env
   sed -i "s/replace-with-strong-password/$(openssl rand -hex 16)/" .env   # или вписать свой
   docker compose --env-file .env up -d
   docker compose ps
   ```
3. DNS: A-запись `grafana.panzers.tg → 45.114.60.33` (делает владелец; вместе с panzers.tg
   на cutover). Caddy в app-стеке маршрутизирует поддомен, как только переменная
   `GRAFANA_DOMAIN=grafana.panzers.tg` есть в окружении `production` и app-стек поднят.
4. Вход: `https://grafana.panzers.tg`, `admin` / `GRAFANA_ADMIN_PASSWORD` из `.env`.

## Доступ ДО готовности домена (опционально)

Пока нет DNS/cutover — посмотреть Grafana можно через SSH-туннель, временно опубликовав
порт только на localhost сервера:
```bash
# на сервере: docker compose ... + добавить grafana ports 127.0.0.1:3000:3000, ЛИБО разово:
ssh -L 3000:127.0.0.1:3000 deploy@45.114.60.33   # если порт опубликован на сервере
```
По умолчанию порт НЕ публикуется (доступ только через Caddy) — для туннеля
раскомментируй `ports` у grafana.

## Проверка
```bash
docker compose exec grafana wget -qO- http://localhost:3000/api/health
docker compose exec victoriametrics wget -qO- 'http://localhost:8428/api/v1/query?query=up' | head
```
В Grafana → Explore → VictoriaMetrics: `up` (cadvisor/node-exporter = 1),
`container_cpu_usage_seconds_total`, `node_load1`. Дашборд: «Panzers — Нагрузка».
