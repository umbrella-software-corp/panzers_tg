// Ежедневный вход — СЕРВЕРНО-авторитетный клейм. Раньше награду начислял клиент
// (store.js claimDaily) против локального profile.daily.last → с другого устройства
// (или после подчистки localStorage) дейлик забирался повторно. Теперь день/стрик и
// выдачу решает ТОЛЬКО сервер под withProfileLock (как бонус канала/фидбека), а merge
// в /api/profile защищает profile.daily от клиентского сейва. Награда кладётся в
// pendingGrants (kind 'bonus') — клиент применит её атомарно на /api/grants-apply, и
// клиентский сейв профиля её не затрёт.
//
// День = UTC YYYY-MM-DD (как исторически писал клиент — toISOString().slice(0,10)),
// чтобы уже сохранённые profile.daily.last не разъехались на миграции. Таблица наград
// ДУБЛИРУЕТ client/src/game/meta.js DAILY_REWARDS — при изменении менять В ОБОИХ местах.
import { loadProfile, saveProfile, withProfileLock } from './db.js'

// 7-дневный цикл. gold = золотые снаряды (goldAmmo на профиле), НЕ валюта.
// жетоны убраны — фарм алмазов только премами (#26); заменены кредитами. ЗЕРКАЛО meta.js.
const DAILY_REWARDS = [
  { credits: 200 },
  { credits: 350 },
  { credits: 400 },
  { credits: 600 },
  { credits: 800 },
  { credits: 700 },
  { credits: 1800, gold: 5 },
]

let grantSeq = 0 // уникальный хвост id гранта дейлика
const dayStr = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 10)

// РАЗОВЫЙ за сутки клейм ежедневного входа. Возвращает:
//  { ok:true, day:<стрик>, reward } — начислили (награда уехала в pendingGrants);
//  { already:true } — сегодня уже забирал (другое устройство/повторный тап).
export async function claimDaily(uid) {
  return withProfileLock(uid, async () => {
    const profile = (await loadProfile(uid)) || {}
    if (!profile.daily || typeof profile.daily !== 'object') profile.daily = { last: '', streak: 0 }
    const today = dayStr()
    if (profile.daily.last === today) return { already: true }
    const yesterday = dayStr(Date.now() - 86400e3)
    const streak = profile.daily.last === yesterday ? (profile.daily.streak || 0) + 1 : 1
    const reward = DAILY_REWARDS[(streak - 1) % DAILY_REWARDS.length]
    profile.daily = { last: today, streak }
    if (reward.credits || reward.tokens || reward.gold) {
      if (!Array.isArray(profile.pendingGrants)) profile.pendingGrants = []
      profile.pendingGrants.push({
        id: 'daily.' + today + '.' + uid + '.' + ++grantSeq,
        kind: 'bonus', // не 'admin' → grants-apply начислит, но окно «🎁» НЕ покажет (у дейлика свой UI)
        credits: reward.credits || 0,
        tokens: reward.tokens || 0,
        goldAmmo: reward.gold || 0,
        tanks: [],
        at: Date.now(),
      })
    }
    await saveProfile(uid, profile)
    return { ok: true, day: streak, reward }
  })
}
