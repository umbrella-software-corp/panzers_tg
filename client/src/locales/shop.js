// Магазин (Shop.vue): премиум-аккаунт, премиум-техника за Stars, ящики снабжения,
// голдовые снаряды, паки кредитов/жетонов. Имена/описания/статы танков уже
// локализованы в meta.js — здесь только обрамление и тексты магазина. Числа в
// строках форматирует fmtNum() в компоненте; русские формы числа — функциями.
export default {
  en: {
    title: 'SHOP',
    // премиум-аккаунт
    premiumHead: 'PREMIUM ACCOUNT',
    premiumTitle: 'PREMIUM · 7 DAYS',
    premiumDesc: '+50% to crew XP, vehicle tree and credits for every battle',
    premiumActive: ({ n }) => `ACTIVE · ${n} DAYS LEFT`,
    premiumLabel: 'Premium · 7 days',
    // премиум-техника
    premTanksHead: 'PREMIUM VEHICLES · FOR TG STARS',
    legend: 'LEGEND',
    stats: 'STATS',
    // {cls} · ур. {tier} · бонусы
    premTankSub: ({ cls, tier }) => `${cls} · T.${tier} · +5% XP/credits, crystals`,
    inGarage: '✓ in garage',
    premTankLabel: ({ name }) => `${name} (premium vehicle)`,
    // ящики снабжения
    cratesHead: 'SUPPLY CRATES',
    crateFieldName: 'Field crate',
    crateFieldSub: ({ credits }) => `${credits} credits · 10% bonus token chance`,
    crateOfficerName: 'Officer crate',
    crateOfficerSub: ({ credits }) => `${credits} credits · 35% token bonus`,
    crateGeneralName: 'General crate',
    crateGeneralSub: ({ credits }) => `${credits} credits · token bonus guaranteed`,
    // голдовые снаряды
    goldHead: 'GOLD SHELLS',
    goldDesc: 'damage +35% per shot',
    goldInStock: ({ n }) => `in stock: ★ ${n} · switch right in battle`,
    // паки за Stars
    creditsHead: 'CREDITS · FOR TG STARS',
    tokensHead: 'TOKENS · FOR TG STARS',
    hot: 'HOT',
    // окно-награда
    youGot: 'YOU GOT',
    rewardCredits: 'credits',
    rewardCamo: ({ name }) => `Camo «${name}»`,
    rewardNew: 'NEW',
    rewardTokens: 'tokens · camos collected',
    claim: 'Claim',
    // тосты / лейблы покупок
    notEnoughTokens: 'Not enough tokens',
    payUnavailable: 'Payment unavailable',
    serverUnavailable: 'Server unavailable',
    granted: ({ label, dev }) => `${label} — credited${dev ? ' (dev)' : ''}!`,
    paid: ({ label }) => `${label} — paid!`,
    goldGot: ({ n }) => `${n} gold shells — received!`,
    // disp — уже отформатированное число (fmtNum); n — для формы слова
    creditsLabel: ({ disp, n }) => `${disp} ${n === 1 ? 'credit' : 'credits'}`,
    tokensLabel: ({ n }) => `${n} ${n === 1 ? 'token' : 'tokens'}`,
  },
  ru: {
    title: 'МАГАЗИН',
    premiumHead: 'ПРЕМИУМ-АККАУНТ',
    premiumTitle: 'ПРЕМИУМ · 7 ДНЕЙ',
    premiumDesc: '+50% к опыту экипажа, ветке техники и кредитам за каждый бой',
    premiumActive: ({ n }) => `АКТИВЕН · ОСТАЛОСЬ ${n} ДН.`,
    premiumLabel: 'Премиум · 7 дней',
    premTanksHead: 'ПРЕМИУМ-ТЕХНИКА · ЗА TG STARS',
    legend: 'ЛЕГЕНДА',
    stats: 'ТТХ',
    premTankSub: ({ cls, tier }) => `${cls} · ур. ${tier} · +5% опыт/кредиты, кристаллы`,
    inGarage: '✓ в гараже',
    premTankLabel: ({ name }) => `${name} (премиум-танк)`,
    cratesHead: 'ЯЩИКИ СНАБЖЕНИЯ',
    crateFieldName: 'Полевой ящик',
    crateFieldSub: ({ credits }) => `${credits} кредитов · шанс на бонус жетонов 10%`,
    crateOfficerName: 'Офицерский ящик',
    crateOfficerSub: ({ credits }) => `${credits} кредитов · бонус жетонов 35%`,
    crateGeneralName: 'Генеральский ящик',
    crateGeneralSub: ({ credits }) => `${credits} кредитов · бонус жетонов гарантирован`,
    goldHead: 'ГОЛДОВЫЕ СНАРЯДЫ',
    goldDesc: 'урон +35% за выстрел',
    goldInStock: ({ n }) => `в наличии: ★ ${n} · переключение прямо в бою`,
    creditsHead: 'КРЕДИТЫ · ЗА TG STARS',
    tokensHead: 'ЖЕТОНЫ · ЗА TG STARS',
    hot: 'ХИТ',
    youGot: 'ВЫ ПОЛУЧИЛИ',
    rewardCredits: 'кредитов',
    rewardCamo: ({ name }) => `Камуфляж «${name}»`,
    rewardNew: 'НОВЫЙ',
    rewardTokens: 'жетона · камуфляжи собраны',
    claim: 'Забрать',
    notEnoughTokens: 'Не хватает жетонов',
    payUnavailable: 'Оплата недоступна',
    serverUnavailable: 'Сервер недоступен',
    granted: ({ label, dev }) => `${label} — зачислено${dev ? ' (dev)' : ''}!`,
    paid: ({ label }) => `${label} — оплачено!`,
    goldGot: ({ n }) => `${n} голдовых снарядов — получено!`,
    // disp — уже отформатированное число (fmtNum); n — для формы слова
    creditsLabel: ({ disp, n }) => {
      const m10 = n % 10
      const m100 = n % 100
      let w = 'кредитов'
      if (m10 === 1 && m100 !== 11) w = 'кредит'
      else if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) w = 'кредита'
      return `${disp} ${w}`
    },
    tokensLabel: ({ n }) => {
      const m10 = n % 10
      const m100 = n % 100
      let w = 'жетонов'
      if (m10 === 1 && m100 !== 11) w = 'жетон'
      else if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) w = 'жетона'
      return `${n} ${w}`
    },
  },
}
