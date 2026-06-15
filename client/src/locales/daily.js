// Ежедневный вход: оверлей серии дней (цикл 7) и кнопка «Забрать».
// Награда собирается из частей: кредиты/жетоны через common.creditsN/tokensN,
// голд — отдельным куском с префиксом ★ (goldStr).
export default {
  en: {
    title: 'DAILY SUPPLY',
    series: ({ n }) => `Day ${n} of the streak — come back every day, rewards grow`,
    claim: ({ reward }) => `CLAIM · ${reward}`,
    got: ({ reward }) => `+ ${reward} ✓`,
    goldStr: ({ n }) => `★${n} gold`,
  },
  ru: {
    title: 'ЕЖЕДНЕВНОЕ ДОВОЛЬСТВИЕ',
    series: ({ n }) => `День ${n} серии — заходи каждый день, награды растут`,
    claim: ({ reward }) => `ЗАБРАТЬ · ${reward}`,
    got: ({ reward }) => `+ ${reward} ✓`,
    goldStr: ({ n }) => `★${n} голд`,
  },
}
