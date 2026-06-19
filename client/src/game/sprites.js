// Единая версия спрайтов (cache-bust) + хелперы URL. БАМПАТЬ SPRITE_VER при каждой
// замене пачки спрайтов, иначе браузер/память сессии отдаёт старый арт под тем же именем.
// Эти URL используют ангар/UI (TankImg на canvas); бой (NetGame, Pixi Assets.load) и
// CSS-фоны тянут ГОЛЫЕ /sprites/...png — это РАЗНЫЕ ключи HTTP-кэша (см. preload.js).
export const SPRITE_VER = '?v=20260618'

export const tankSpriteUrl = (id) => `/sprites/tanks/${id}.png${SPRITE_VER}`
export const hangarSpriteUrl = (id) => `/sprites/hangar/${id}.png${SPRITE_VER}`
export const camoSpriteUrl = (id, camo) => `/sprites/camo/${id}_${camo}.png${SPRITE_VER}`
