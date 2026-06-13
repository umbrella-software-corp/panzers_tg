// Серверная аналитика Amplitude (HTTP API). Опциональна: без AMPLITUDE_API_KEY
// молча выключена. Аналитика НИКОГДА не должна ронять геймплей — все ошибки глотаем.
// Ключ — тот же ПУБЛИЧНЫЙ API Key проекта, что и на клиенте (httpapi берёт api_key,
// а НЕ secret key). user_id здесь = profile uid (tg_<id>) — совпадает с клиентским,
// поэтому серверные события сшиваются с клиентской воронкой того же юзера.
const API_KEY = process.env.AMPLITUDE_API_KEY || ''

export const analyticsEnabled = () => !!API_KEY

export async function trackServer(userId, eventType, props = {}) {
  if (!API_KEY || !userId || !eventType) return
  try {
    await fetch('https://api2.amplitude.com/2/httpapi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: API_KEY,
        events: [
          {
            user_id: String(userId),
            event_type: eventType,
            event_properties: {
              app: 'panzers_tg',
              env: process.env.NODE_ENV || 'production',
              ...props,
            },
          },
        ],
      }),
    })
  } catch {
    // аналитика не должна ломать бой
  }
}
