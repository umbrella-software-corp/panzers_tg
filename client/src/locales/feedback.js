// «Нам важно ваше мнение» — баннер в ангаре + лист бонуса за фидбек в саппорт-бот
export default {
  en: {
    banner: 'Your opinion matters',
    title: 'Your opinion matters',
    body: ({ n }) => `Drop us a line in support — what you love, what bugs you. We read everything. For your feedback: +${n} tokens 💎`,
    write: '✍️ Write to support',
    claim: ({ n }) => `I wrote — claim +${n}`,
    notYet: 'First write a couple of words in support, then claim 🙂',
    error: 'Network issue — try again',
    thanks: 'Thanks for the feedback!',
  },
  ru: {
    banner: 'Нам важно ваше мнение',
    title: 'Нам важно ваше мнение',
    body: ({ n }) => `Напиши пару слов в поддержку — что нравится, что бесит. Читаем всё. За фидбек: +${n} жетонов 💎`,
    write: '✍️ Написать в поддержку',
    claim: ({ n }) => `Я написал — забрать +${n}`,
    notYet: 'Сначала напиши пару слов в поддержку, потом забери 🙂',
    error: 'Сеть барахлит — попробуй ещё',
    thanks: 'Спасибо за фидбек!',
  },
}
