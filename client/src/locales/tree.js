// Экран «Развитие» (Tree.vue): ветка нации, исследование танков по чеклисту,
// док выбранной машины с модулями, премиум-техника за ⭐. {name} — имя танка
// (уже локализовано в meta), подставляется в строки-функции/плейсхолдеры.
export default {
  en: {
    title: 'TECH TREE',
    // строка под названием узла: класс · ур. N
    classTier: ({ cls, tier }) => `${cls} · tier ${tier}`,
    topModules: ({ n, total }) => `top modules ${n}/${total}`,
    available: 'Available to research',
    // чеклист разблокировки
    checkResearch: ({ name }) => `Research ${name}`,
    checkTopModules: ({ name }) => `Top modules ${name}`,
    checkXp: 'Branch XP',
    branchXp: 'Branch XP',
    // свободный опыт: общий пул, вкладывается в любую нацию
    freeXp: 'Free XP',
    pourFree: ({ n }) => `Invest ${n} →`,
    freeXpHint: 'This branch has enough — switch nation to invest',
    checkCredits: 'Credits',
    // переход к недостающему шагу
    stepUnlock: ({ name }) => `Unlock ${name}`,
    stepModules: ({ name }) => `To modules ${name}`,
    // премиум-техника
    premHead: '★ PREMIUM VEHICLES',
    legend: 'LEGEND',
    spec: 'STATS',
    premPerk: ({ cls, tier }) => `${cls} · tier ${tier} · +5% XP/credits, crystals`,
    inGarage: '✓ in garage',
    // док выбранной (купленной) машины
    ownedHint: 'Research all top modules to unlock the next vehicle in the branch.',
    installed: 'Installed ★',
    locked: 'locked',
    pickInHangar: 'Select in garage',
    // CTA исследования
    meetConditions: 'MEET THE CONDITIONS ABOVE',
    need: 'NEED',
    research: ({ cost }) => `RESEARCH · ${cost}`,
  },
  ru: {
    title: 'РАЗВИТИЕ',
    classTier: ({ cls, tier }) => `${cls} · ур. ${tier}`,
    topModules: ({ n, total }) => `топ-модули ${n}/${total}`,
    available: 'Доступен к исследованию',
    checkResearch: ({ name }) => `Исследовать ${name}`,
    checkTopModules: ({ name }) => `Топ-модули ${name}`,
    checkXp: 'Опыт ветки',
    branchXp: 'Опыт ветки',
    freeXp: 'Свободный опыт',
    pourFree: ({ n }) => `Вложить ${n} →`,
    freeXpHint: 'Этой ветке хватает — переключи нацию и вложи',
    checkCredits: 'Кредиты',
    stepUnlock: ({ name }) => `Открыть ${name}`,
    stepModules: ({ name }) => `К модулям ${name}`,
    premHead: '★ ПРЕМИУМ-ТЕХНИКА',
    legend: 'ЛЕГЕНДА',
    spec: 'ТТХ',
    premPerk: ({ cls, tier }) => `${cls} · ур. ${tier} · +5% опыт/кредиты, кристаллы`,
    inGarage: '✓ в гараже',
    ownedHint: 'Изучи все топ-модули, чтобы открыть следующую машину ветки.',
    installed: 'Установлен ★',
    locked: 'закрыто',
    pickInHangar: 'Выбрать в ангаре',
    meetConditions: 'ВЫПОЛНИ УСЛОВИЯ ВЫШЕ',
    need: 'НУЖНО',
    research: ({ cost }) => `ИССЛЕДОВАТЬ · ${cost}`,
  },
}
