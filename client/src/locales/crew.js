// Экран «Экипаж» (Crew.vue): уровень и опыт, очки навыка, перки специалистов.
// {role}/{perk} приходят из CREW_MEMBERS (уже локализованы) — переводим только
// обрамление. Русские формы числа задаём функциями-значениями.
export default {
  en: {
    title: 'CREW',
    level: ({ lvl }) => `LEVEL ${lvl}`,
    max: ' · MAX',
    trainingCap: 'training cap',
    xpLine: ({ into, need }) => `${into} / ${need} XP`,
    levelBuff: 'A level grants +1% to rate of fire, view range, mobility and traverse — and 1 skill point.',
    skillPoints: ({ n }) => `Skill points: ${n}`,
    // чипы итогового баффа
    buffDmg: ({ n }) => `damage +${n}%`,
    buffReload: ({ n }) => `rate +${n}%`,
    buffRun: ({ n }) => `mobility +${n}%`,
    buffVision: ({ n }) => `view +${n}%`,
    specialists: 'Specialists',
    // «{perk}» · {effect}
    perkLine: ({ perk, effect }) => `«${perk}» · ${effect}`,
    maxRank: 'MAX ★',
    pointAt: ({ lvl }) => `point at lvl ${lvl}`,
    note: 'One crew serves all vehicles and earns half the XP of each battle. There are fewer skill points than ranks — choose a specialization wisely.',
    // тост и ошибки
    rankToast: ({ role, perk, rank }) => `${role}: «${perk}» — rank ${rank}`,
    noPoints: 'No skill points — level up the crew in battles',
    noCredits: 'Not enough credits',
  },
  ru: {
    title: 'ЭКИПАЖ',
    level: ({ lvl }) => `УРОВЕНЬ ${lvl}`,
    max: ' · МАКС',
    trainingCap: 'предел подготовки',
    xpLine: ({ into, need }) => `${into} / ${need} ОП`,
    levelBuff: 'Уровень даёт +1% к темпу, обзору, ходу и манёвру — и 1 очко навыка.',
    skillPoints: ({ n }) => `Очки навыка: ${n}`,
    buffDmg: ({ n }) => `урон +${n}%`,
    buffReload: ({ n }) => `темп +${n}%`,
    buffRun: ({ n }) => `ход +${n}%`,
    buffVision: ({ n }) => `обзор +${n}%`,
    specialists: 'Специалисты',
    perkLine: ({ perk, effect }) => `«${perk}» · ${effect}`,
    maxRank: 'МАКС ★',
    pointAt: ({ lvl }) => `очко на ур. ${lvl}`,
    note: 'Экипаж один на все машины и получает половину опыта каждого боя. Очков навыка меньше, чем рангов, — выбирайте специализацию с умом.',
    rankToast: ({ role, perk, rank }) => `${role}: «${perk}» — ранг ${rank}`,
    noPoints: 'Нет очков навыка — качайте уровень экипажа в боях',
    noCredits: 'Не хватает кредитов',
  },
}
