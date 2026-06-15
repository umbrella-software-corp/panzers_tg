// Модалка медали (MedalSheet.vue): тип, условие, награда и статус получения.
// Название/описание медали приходят из props.medal (уже локализованы) — здесь
// только обрамление. Тиры (Бронза/Серебро/Золото) берём из game.medalTiers.*.
// timesGot — функция-значение: русские формы «раз/раза/раз» по числу.
export default {
  en: {
    typeCareer: 'Career',
    typeBattle: 'Battle',
    howTo: 'HOW TO EARN',
    hintCareer: 'A milestone on cumulative stats — awarded once.',
    hintBattle: 'Awarded for each qualifying battle.',
    reward: 'REWARD',
    rewardSub: 'for the first time earned',
    earnedOnce: '✓ Earned',
    timesGot: ({ n }) => `✓ Earned ${n} ${n === 1 ? 'time' : 'times'}`,
    notEarned: 'Not earned yet',
  },
  ru: {
    typeCareer: 'Карьерная',
    typeBattle: 'Боевая',
    howTo: 'КАК ПОЛУЧИТЬ',
    hintCareer: 'Рубеж по суммарной статистике — выдаётся один раз.',
    hintBattle: 'Начисляется за каждый подходящий бой.',
    reward: 'НАГРАДА',
    rewardSub: 'за первое получение',
    earnedOnce: '✓ Получена',
    timesGot: ({ n }) => {
      const m10 = n % 10
      const m100 = n % 100
      let w = 'раз'
      if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) w = 'раза'
      return `✓ Получена ${n} ${w}`
    },
    notEarned: 'Ещё не получена',
  },
}
