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
    levelBuff: 'Each level: +0.15% to rate of fire, view, mobility and traverse; a skill point every 2 levels.',
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
    note: 'One crew serves all vehicles and earns a share of each battle XP. 100 levels — a long grind; by max you can fully train every specialist.',
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
    levelBuff: 'Уровень: +0.15% к темпу, обзору, ходу и манёвру; очко навыка — раз в 2 уровня.',
    skillPoints: ({ n }) => `Очки навыка: ${n}`,
    buffDmg: ({ n }) => `урон +${n}%`,
    buffReload: ({ n }) => `темп +${n}%`,
    buffRun: ({ n }) => `ход +${n}%`,
    buffVision: ({ n }) => `обзор +${n}%`,
    specialists: 'Специалисты',
    perkLine: ({ perk, effect }) => `«${perk}» · ${effect}`,
    maxRank: 'МАКС ★',
    pointAt: ({ lvl }) => `очко на ур. ${lvl}`,
    note: 'Экипаж один на все машины и получает долю опыта каждого боя. 100 уровней — долгий грайнд; к максу прокачаешь всех специалистов полностью.',
    rankToast: ({ role, perk, rank }) => `${role}: «${perk}» — ранг ${rank}`,
    noPoints: 'Нет очков навыка — качайте уровень экипажа в боях',
    noCredits: 'Не хватает кредитов',
  },
}
