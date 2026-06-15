// Карточка профиля игрока (PlayerCard.vue): шапка, рейтинг, плитки статистики,
// любимая техника, медали. Имя ранга/полоса рейтинга/название танка приходят
// уже локализованными — здесь только обрамление и подписи плиток.
export default {
  en: {
    premiumAccount: 'PREMIUM ACCOUNT',
    placeInRating: ({ n }) => `RANK ${n} IN RATING`,
    statBattles: 'battles',
    statWinrate: 'win rate',
    statKills: 'frags',
    favoriteTank: 'FAVORITE VEHICLE',
    medals: 'MEDALS',
    noMedals: 'none yet — battles and feats ahead',
  },
  ru: {
    premiumAccount: 'ПРЕМИУМ-АККАУНТ',
    placeInRating: ({ n }) => `МЕСТО ${n} В РЕЙТИНГЕ`,
    statBattles: 'боёв',
    statWinrate: 'винрейт',
    statKills: 'фрагов',
    favoriteTank: 'ЛЮБИМАЯ ТЕХНИКА',
    medals: 'МЕДАЛИ',
    noMedals: 'пока нет — впереди бои и подвиги',
  },
}
