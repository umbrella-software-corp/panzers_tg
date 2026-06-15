// Серверный i18n для исходящих сообщений Telegram (бот, пуши, оплата, саппорт,
// названия турниров). Язык выбираем по language_code пользователя из апдейтов/
// initData: 'ru*' → русский, всё остальное → английский. Язык конкретного юзера
// храним в профиле (p.lang); недостающий язык (легаси-профили) трактуем как 'ru'
// — это исходная аудитория, чтобы не слать им внезапный английский.
// API: t('ns.key', lang, params). Значение может быть строкой с {плейсхолдерами}
// или функцией (params) => string.

export function pickLang(code) {
  return String(code || '').toLowerCase().startsWith('ru') ? 'ru' : 'en'
}
// язык для исходящих юзеру: профиль → 'ru' дефолтом (легаси-база русскоязычная)
export const langOf = (profile) => (profile && profile.lang === 'en' ? 'en' : profile && profile.lang === 'ru' ? 'ru' : 'ru')

const DICT = {
  en: {
    defaultName: 'Soldier',
    lobbyPlayer: ({ id }) => `Player ${id}`,
    // игровой бот
    greet: 'Panzer TG — 7×7 tank battles right inside Telegram. Hit "Play" and roll out! 🎖',
    greetButton: '🎮 Play',
    playButton: '🎮 BATTLE',
    stopConfirm: 'Notifications off 🔕 To turn them back on — send /start',
    // пуши
    digestWinback: '🎖 Commander, you have been away for a while — your crew misses you! Your daily reward is piling up and new tasks await in the garage. Drop in for a couple of battles 🔥\n\n/stop — unsubscribe',
    digestRegular: "🎁 Commander, your daily reward is ready and today's tasks have refreshed! A quick battle takes a couple of minutes — jump in 🔥\n\n/stop — unsubscribe",
    friendInBattle: ({ name }) => `🔥 Your friend ${name} is in battle right now! Jump in together ⚔️\n\n/stop — unsubscribe`,
    // заголовки товаров (счёт Telegram Stars)
    products: {
      p1: '1,000 credits',
      p2: '3,500 credits',
      p3: '9,000 credits',
      t1: '20 tokens',
      t2: '60 tokens',
      t3: '150 tokens',
      rename: 'Callsign change',
      prem: 'Premium account · 7 days',
      pt_t28: 'T-28 · premium tank',
      pt_t54: 'T-54 · premium tank',
      pt_pz4h: 'Pz. IV H · premium tank',
      pt_maus: 'Maus · premium tank',
      pt_ram: 'Ram II · premium tank',
      pt_sper: 'Super Pershing · premium tank',
    },
    invoiceRename: ({ name }) => `Panzer TG · new callsign "${name}"`,
    invoiceDesc: ({ title }) => `Panzer TG · ${title}`,
    // турниры (по id)
    tournaments: {
      t2v2_light: 'Light Cavalry',
      t3v3_medium: 'Medium Clinch',
      t3v3_any: 'Triple Strike',
      t5v5_heavy: 'Steel Surge',
      t5v5_any: 'Grand Muster',
    },
    // саппорт-бот
    sup: {
      hereInPrivate: "Type /here IN THE DEVELOPERS' GROUP — that is where player tickets will go.",
      hereNotAdmin: 'Only a group admin can set the tickets group.',
      hereDone: ({ id }) => `✅ Done — player tickets now come HERE (chat.id=${id}). Reply to them and the answer goes to the player.`,
      start: "Hi! This is Panzer TG support. Describe your problem or question — we'll pass it to the developer and reply right here. Text, screenshots, video and voice all work.",
      notConfigured: 'Support is still being set up — write again a bit later.',
      deliveryFailed: "Couldn't deliver your message yet — we're on it. Please write again a bit later.",
      ticketDone: ({ n }) => `✅ Ticket #${n} delivered to the developer — we'll reply here.`,
    },
  },
  ru: {
    defaultName: 'Боец',
    lobbyPlayer: ({ id }) => `Игрок ${id}`,
    greet: 'Panzer TG — танковые бои 7×7 прямо в Telegram. Жми «Играть» и в бой! 🎖',
    greetButton: '🎮 Играть',
    playButton: '🎮 В БОЙ',
    stopConfirm: 'Уведомления выключены 🔕 Включить снова — отправь /start',
    digestWinback: '🎖 Командир, тебя давно не было — экипаж скучает! Ежедневная награда копится, новые задачи ждут в ангаре. Заскочи на пару боёв 🔥\n\n/stop — отписаться',
    digestRegular: '🎁 Командир, ежедневная награда доступна, а задачи дня обновились! Быстрый бой за пару минут — залетай 🔥\n\n/stop — отписаться',
    friendInBattle: ({ name }) => `🔥 Твой друг ${name} сейчас в бою! Залетай вместе ⚔️\n\n/stop — отписаться`,
    products: {
      p1: '1 000 кредитов',
      p2: '3 500 кредитов',
      p3: '9 000 кредитов',
      t1: '20 жетонов',
      t2: '60 жетонов',
      t3: '150 жетонов',
      rename: 'Смена позывного',
      prem: 'Премиум-аккаунт · 7 дней',
      pt_t28: 'Т-28 · премиум-танк',
      pt_t54: 'Т-54 · премиум-танк',
      pt_pz4h: 'Pz. IV H · премиум-танк',
      pt_maus: 'Maus · премиум-танк',
      pt_ram: 'Ram II · премиум-танк',
      pt_sper: 'Super Pershing · премиум-танк',
    },
    invoiceRename: ({ name }) => `Panzer TG · новый позывной «${name}»`,
    invoiceDesc: ({ title }) => `Panzer TG · ${title}`,
    tournaments: {
      t2v2_light: 'Лёгкая кавалерия',
      t3v3_medium: 'Средний клинч',
      t3v3_any: 'Тройной удар',
      t5v5_heavy: 'Стальной вал',
      t5v5_any: 'Большой сбор',
    },
    sup: {
      hereInPrivate: 'Команду /here пиши В ГРУППЕ разработчиков — туда пойдут тикеты игроков.',
      hereNotAdmin: 'Назначить группу для тикетов может только её админ.',
      hereDone: ({ id }) => `✅ Готово — тикеты игроков теперь идут СЮДА (chat.id=${id}). Отвечайте на них реплаем — ответ уйдёт игроку.`,
      start: 'Привет! Это поддержка Panzer TG. Опиши проблему или вопрос — передадим разработчику и ответим прямо здесь. Можно текст, скриншоты, видео, голос.',
      notConfigured: 'Поддержка ещё настраивается — напиши чуть позже.',
      deliveryFailed: 'Пока не получилось передать сообщение — уже разбираемся. Напиши ещё раз чуть позже.',
      ticketDone: ({ n }) => `✅ Тикет #${n} передан разработчику — ответим здесь.`,
    },
  },
}

function lookup(node, key) {
  for (const part of key.split('.')) {
    if (node == null) return undefined
    node = node[part]
  }
  return node
}

export function t(key, lang, params) {
  const l = lang === 'en' || lang === 'ru' ? lang : 'ru'
  let val = lookup(DICT[l], key)
  if (val === undefined && l !== 'en') val = lookup(DICT.en, key)
  if (val === undefined) return key
  if (typeof val === 'function') return val(params || {})
  if (typeof val === 'string' && params) return val.replace(/\{(\w+)\}/g, (m, n) => (params[n] != null ? params[n] : m))
  return val
}
