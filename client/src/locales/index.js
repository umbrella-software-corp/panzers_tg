// Аггрегатор словарей. Каждый домен — отдельный файл `export default { en, ru }`
// (en/ru — деревья строк под общим неймспейсом). Здесь собираем их в
// dicts = { en: {ns: ...}, ru: {ns: ...} } для i18n.js. Новый домен — добавить
// импорт и строку в обоих объектах.
import common from './common.js'
import game from './game.js'
import nav from './nav.js'
import hangar from './hangar.js'
import onboarding from './onboarding.js'
import daily from './daily.js'
import tasks from './tasks.js'
import tree from './tree.js'
import crew from './crew.js'
import shop from './shop.js'
import rating from './rating.js'
import squad from './squad.js'
import player from './player.js'
import medals from './medals.js'
import matchmaking from './matchmaking.js'
import battle from './battle.js'
import results from './results.js'
import channel from './channel.js'
import feedback from './feedback.js'
import settings from './settings.js'
import news from './news.js'

const domains = { common, game, nav, hangar, onboarding, daily, tasks, tree, crew, shop, rating, squad, player, medals, matchmaking, battle, results, channel, feedback, settings, news }

function pick(lang) {
  const out = {}
  for (const [ns, mod] of Object.entries(domains)) out[ns] = (mod && mod[lang]) || {}
  return out
}

export const dicts = { en: pick('en'), ru: pick('ru') }
