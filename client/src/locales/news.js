// Разовая модалка-анонс события (показывается один раз, см. NEWS_VERSION / EventNews.vue).
// v1 — «Борьба за рейтинг»: множитель кредитов за бой по месту в таблице + кристаллы
// за активность. Тексты держим в синхроне с карточкой события в Rating.vue (locales/rating.js).
export default {
  en: {
    kicker: 'NEW EVENT',
    title: 'RATING WAR',
    lead: 'The higher you sit in the rating, the more you earn — every single battle.',
    credits: '💰 Top ranks earn more credits per battle',
    crystals: '💎 +1 crystal per battle · up to 10 a day',
    tiers: 'Top-1 +50% · Top-3 +30% · Top-10 +15% · Top-50 +5%',
    cta: "LET'S GO ▸",
    table: 'View leaderboard',
  },
  ru: {
    kicker: 'НОВОЕ СОБЫТИЕ',
    title: 'БОРЬБА ЗА РЕЙТИНГ',
    lead: 'Чем выше ты в рейтинге — тем больше зарабатываешь за каждый бой.',
    credits: '💰 Топ таблицы получает больше кредитов за бой',
    crystals: '💎 +1 кристалл за бой · до 10 в день',
    tiers: 'Топ-1 +50% · Топ-3 +30% · Топ-10 +15% · Топ-50 +5%',
    cta: 'ПОГНАЛИ ▸',
    table: 'Открыть таблицу',
  },
}
