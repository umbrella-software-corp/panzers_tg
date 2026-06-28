// Настройки игрока (шторка из ангара): чекбокс реверсивного управления задним ходом
// (часть игроков просила вернуть старое управление после фикса инверсии) + поддержка.
export default {
  en: {
    title: 'Settings',
    render3dLabel: '3D graphics (beta)',
    render3dHint: 'Render battles in 3D. Heavy devices auto-fall back to 2D.',
    reverseLabel: 'Reverse steering',
    reverseHint: 'On: in reverse the tank backs toward the joystick (push back-left → back left). Off: classic controls.',
    joyFixedLabel: 'Fixed joystick',
    joyFixedHint: 'On: the joystick stays in the lower-left corner (predictable — up is always forward). Off: it appears wherever you touch.',
    applyNote: 'Takes effect in your next battle.',
    support: 'Support',
    supportSub: 'A question or a bug? Message us.',
    done: 'Done',
  },
  ru: {
    title: 'Настройки',
    render3dLabel: '3D-графика (бета)',
    render3dHint: 'Бои в 3D. На слабых устройствах авто-откат в 2D.',
    reverseLabel: 'Реверсивное управление',
    reverseHint: 'Вкл: на заднем ходу корма идёт по джойстику (назад-влево → едешь назад-влево). Выкл: классическое управление.',
    joyFixedLabel: 'Фиксированный джойстик',
    joyFixedHint: 'Вкл: джойстик всегда в левом нижнем углу (предсказуемо — вверх всегда вперёд). Выкл: появляется там, где касаешься.',
    applyNote: 'Применится в следующем бою.',
    support: 'Поддержка',
    supportSub: 'Вопрос или баг — напиши нам.',
    done: 'Готово',
  },
}
