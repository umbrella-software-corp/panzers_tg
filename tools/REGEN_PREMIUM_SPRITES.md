# Перегенерация платных (премиум) спрайтов — статус / handoff

Контекст для продолжения в новой сессии (контейнер эфемерный — память только в репо).

## Задача
1. Перегенерить все ПЛАТНЫЕ спрайты = 6 премиум-танков за Telegram Stars
   (`PREMIUM_TANKS` в `client/src/game/meta.js`):
   `t28`, `t54`, `pz4h`, `maus`, `ram`, `sper`.
   Причина: половина (`t54`, `pz4h`, `sper`, `maus`) нарисована в 3/4-перспективе,
   а базовые танки (`t34`, `t28`) — строго СВЕРХУ на магента-хромакее. Надо привести
   к единому строго top-down виду.
2. Запретить выбор камуфляжа на прем-танках. ✅ СДЕЛАНО (коммит на ветке).

## Как генерить (по ОДНОЙ, показывать юзеру каждую)
Юзер просил: генерить по одной → показывать картинку → подтверждать, что строго
сверху → только потом следующая. Если перспектива не top-down — править промпт
в `tools/gen-tank.mjs` и перегенерять ту же машину.

```
REPLICATE_API_TOKEN=<токен от юзера в чате> node tools/gen-tank.mjs t28
# показать client/public/sprites/tanks/t28.png юзеру, дождаться ОК, затем t54 и т.д.
```
Все сразу: `node tools/gen-tank.mjs all`

## Готово в ветке `claude/paid-sprites-regen-0apyrk`
- `tools/gen-tank.mjs` — батч-генератор именно 6 прем-танков. Строгий top-down +
  магента-фон (формулировка из проверенного `gen-camo.mjs`), описания реальных машин
  (T-28 трёхбашенный, T-54, Pz.IV H со «шторками», Maus сверхтяж, Ram II, Super Pershing).
  Модель по умолчанию `black-forest-labs/flux-dev` (как в gen-sprite.mjs), `MODEL=` для смены.
- `client/src/components/Hangar.vue` — камо-блок скрыт для `tank.premium`,
  `dispCamo` → '' для прем-танка (заводской облик даже если камо сохранялось раньше).
  Клиент собирается (`pnpm -C client build`).

## БЛОКЕР (на момент написания)
Сеть до Replicate резалась прокси: `Host not in allowlist` для `api.replicate.com`,
`replicate.delivery`, `pbxt.replicate.delivery`. Юзер открыл эти домены в настройках
окружения (Network access → Custom → Allowed domains: `api.replicate.com`,
`*.replicate.delivery` + галка package managers). Egress применяется на СТАРТЕ сессии,
поэтому нужна НОВАЯ сессия, чтобы доступ заработал.

## Первое действие в новой сессии
Проверить доступ и, если открыт, начать генерацию с `t28`:
```
node -e "fetch('https://api.replicate.com/v1/models').then(r=>console.log(r.status)).catch(e=>console.log(e.message))"
```
Токен Replicate юзер давал в чате (в репозиторий НЕ коммитим). Если его нет под рукой —
попросить снова.
