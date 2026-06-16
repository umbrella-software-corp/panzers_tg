// Тур по ангару для самого первого входа: 3 шага-коачмарка (танк → режим → В БОЙ).
// steps — массив { title, body, cta } в порядке STEPS компонента; читается по индексу.
export default {
  en: {
    step: ({ n, total }) => `STEP ${n}/${total}`,
    skip: 'Skip',
    // обучающий гайд первого боя (поверх живого боя; враги заморожены) — порядок шагов
    // совпадает со STEPS компонента TrainingGuide: drive → aim → fire
    trainSkip: 'Skip training',
    train: [
      { title: 'Drive', body: 'Drag your finger across the screen — the tank follows it. Move forward, toward the enemy.' },
      { title: 'Aim', body: 'Turn your hull toward the enemy. When the aim line turns green — that’s a LOCK.' },
      { title: 'Fire!', body: 'Gun ready and locked on? Hit FIRE.' },
    ],
    // подарок «выбери второй танк» после первого боя
    secondTank: {
      title: 'Choose your second tank',
      sub: 'On us — for your first battle. You can unlock the rest later in the Tech Tree.',
      cta: ({ name }) => `Unlock ${name}`,
      free: 'FREE',
    },
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
    // обучающий гайд первого боя (поверх живого боя; враги заморожены): едь → целься → огонь
    trainSkip: 'Пропустить обучение',
    train: [
      { title: 'Веди танк', body: 'Тащи палец по экрану — танк едет за пальцем. Двигайся вперёд, к врагу.' },
      { title: 'Целься', body: 'Поверни корпус на врага. Линия прицела позеленела — это ЗАХВАТ.' },
      { title: 'Огонь!', body: 'Орудие готово и захват есть? Жми ОГОНЬ.' },
    ],
    // подарок «выбери второй танк» после первого боя
    secondTank: {
      title: 'Выбери второй танк',
      sub: 'Дарим за первый бой. Остальные откроешь позже в «Развитии».',
      cta: ({ name }) => `Открыть ${name}`,
      free: 'БЕСПЛАТНО',
    },
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
