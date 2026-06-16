// Общие атомы, переиспользуемые во многих экранах: кнопки, исходы боя, валюты,
// режимы. Доменам НЕ дублировать эти строки — звать common.* через t().
// Значения-функции принимают { n } и дают правильную форму множественного числа.
export default {
  en: {
    appName: 'PANZER TG',
    beta: 'BETA',
    // кнопки / действия
    close: 'Close',
    cancel: 'Cancel',
    create: 'Create',
    back: 'Back',
    retry: 'Retry',
    ok: 'OK',
    toHangar: 'To garage',
    continue: 'Continue',
    play: 'BATTLE',
    // исходы боя (стенсил, верхний регистр — как в дизайне)
    victory: 'VICTORY',
    defeat: 'DEFEAT',
    draw: 'DRAW',
    // режимы боя
    modeCapture: 'CAPTURE',
    modeCapturePoints: 'CAPTURE POINTS',
    modeAnnihilation: 'ANNIHILATION',
    // валюты / единицы (как ярлык)
    credits: 'Credits',
    tokens: 'Tokens',
    gold: 'Gold',
    stars: 'Stars',
    xp: 'XP',
    premium: 'PREMIUM',
    premiumShort: 'PREM',
    online: 'ONLINE',
    onlineNow: ({ n }) => `${n} online`,
    // подарок от администрации (App.vue, когда применилась админ-выдача)
    adminGiftTitle: 'Gift from the team!',
    adminGiftTank: 'Tank',
    adminGiftClaim: 'Awesome, thanks!',
    // стартовый сплэш (App.vue)
    bootSub: 'preparing the garage…',
    bootFoot: 'early access · build in active development',
    // валюты с числом (множественное число)
    creditsN: ({ n }) => `${n} credits`,
    tokensN: ({ n }) => `${n} ${n === 1 ? 'token' : 'tokens'}`,
    goldN: ({ n }) => `${n} gold`,
    xpN: ({ n }) => `${n} XP`,
    days: ({ n }) => `${n}d`,
  },
  ru: {
    appName: 'PANZER TG',
    beta: 'БЕТА',
    close: 'Закрыть',
    cancel: 'Отмена',
    create: 'Создать',
    back: 'Назад',
    retry: 'Повторить',
    ok: 'ОК',
    toHangar: 'В ангар',
    continue: 'Продолжить',
    play: 'В БОЙ',
    victory: 'ПОБЕДА',
    defeat: 'ПОРАЖЕНИЕ',
    draw: 'НИЧЬЯ',
    modeCapture: 'ЗАХВАТ',
    modeCapturePoints: 'ЗАХВАТ ТОЧЕК',
    modeAnnihilation: 'НА УНИЧТОЖЕНИЕ',
    credits: 'Кредиты',
    tokens: 'Жетоны',
    gold: 'Голд',
    stars: 'Звёзды',
    xp: 'ОП',
    premium: 'ПРЕМИУМ',
    premiumShort: 'ПРЕМ',
    online: 'ОНЛАЙН',
    onlineNow: ({ n }) => `${n} в сети`,
    adminGiftTitle: 'Подарок от администрации!',
    adminGiftTank: 'Танк',
    adminGiftClaim: 'Круто, спасибо!',
    bootSub: 'готовим ангар…',
    bootFoot: 'ранний доступ · билд в активной разработке',
    creditsN: ({ n }) => {
      const m10 = n % 10
      const m100 = n % 100
      let w = 'кредитов'
      if (m10 === 1 && m100 !== 11) w = 'кредит'
      else if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) w = 'кредита'
      return `${n} ${w}`
    },
    tokensN: ({ n }) => {
      const m10 = n % 10
      const m100 = n % 100
      let w = 'жетонов'
      if (m10 === 1 && m100 !== 11) w = 'жетон'
      else if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) w = 'жетона'
      return `${n} ${w}`
    },
    goldN: ({ n }) => `${n} голд`,
    xpN: ({ n }) => `${n} ОП`,
    days: ({ n }) => `${n}д`,
  },
}
