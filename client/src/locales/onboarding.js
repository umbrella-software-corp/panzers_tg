// Тур по ангару для самого первого входа: 3 шага-коачмарка (танк → режим → В БОЙ).
// steps — массив { title, body, cta } в порядке STEPS компонента; читается по индексу.
export default {
  en: {
    step: ({ n, total }) => `STEP ${n}/${total}`,
    skip: 'Skip',
    steps: [
      {
        title: 'This is your tank',
        body: 'Your battle vehicle. Below — all your vehicles: scroll, pick, unlock new ones in the Tech Tree.',
        cta: 'Next ▸',
      },
      {
        title: 'Battle mode',
        body: 'CAPTURE — a quick points match, perfect to start. ANNIHILATION — fight to the last.',
        cta: 'Next ▸',
      },
      {
        title: 'Finish your first battle → +1000 credits',
        body: "Hit it and let's roll. The first battles are easy: aim at the green frame and fire. See the battle through to the end for your reward.",
        cta: 'BATTLE ▸',
      },
    ],
  },
  ru: {
    step: ({ n, total }) => `ШАГ ${n}/${total}`,
    skip: 'Пропустить',
    steps: [
      {
        title: 'Это твой танк',
        body: 'Твоя боевая машина. Внизу — вся техника: листай, выбирай, открывай новую в «Развитии».',
        cta: 'Дальше ▸',
      },
      {
        title: 'Режим боя',
        body: 'ЗАХВАТ — быстрая катка на точки, самое то для старта. НА УНИЧТОЖЕНИЕ — бой до последнего.',
        cta: 'Дальше ▸',
      },
      {
        title: 'Заверши первый бой → +1000 кредитов',
        body: 'Жми — и поехали. Первые бои лёгкие: целься в зелёную рамку и стреляй. Доведи бой до конца — получишь награду.',
        cta: 'В БОЙ ▸',
      },
    ],
  },
}
