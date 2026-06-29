<script setup>
// Разовая модалка-анонс события (показывается ОДИН раз, гейт в App.vue по
// profile.newsSeen < NEWS_VERSION). v1 — «Борьба за рейтинг». Тексты — locales/news.js,
// держим в синхроне с карточкой события в Rating.vue. Закрытие/«К таблице» ставят
// newsSeen = NEWS_VERSION (персистится сам через deep-watch стора).
import { onMounted } from 'vue'
import { haptic } from '../tg.js'
import { track } from '../analytics.js'
import { t } from '../i18n.js'

const emit = defineEmits(['close', 'table'])

function close() {
  haptic('light')
  track('event_news_closed', { news: 1, action: 'cta' })
  emit('close')
}
function toTable() {
  haptic('light')
  track('event_news_closed', { news: 1, action: 'table' })
  emit('table')
}

onMounted(() => track('event_news_shown', { news: 1 }))
</script>

<template>
  <Teleport to="body">
    <div class="news-ovl">
      <div class="news-card">
        <div class="news-glow"></div>
        <div class="news-kicker pz-pixel">{{ t('news.kicker') }}</div>
        <div class="news-emo">⚔️</div>
        <div class="news-title pz-display">{{ t('news.title') }}</div>
        <div class="news-lead">{{ t('news.lead') }}</div>

        <div class="news-rows">
          <div class="news-row">{{ t('news.credits') }}</div>
          <div class="news-row">{{ t('news.crystals') }}</div>
        </div>

        <div class="news-tiers pz-pixel">{{ t('news.tiers') }}</div>

        <button class="pz-cta pz-cta--hazard news-cta" @click="close">{{ t('news.cta') }}</button>
        <button class="news-link" @click="toTable">{{ t('news.table') }}</button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.news-ovl {
  position: fixed;
  inset: 0;
  z-index: 95;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(8, 9, 6, 0.82);
  animation: news-fade 0.2s ease;
}
@keyframes news-fade {
  from {
    opacity: 0;
  }
}
.news-card {
  position: relative;
  width: 100%;
  max-width: 360px;
  padding: 22px 20px 18px;
  text-align: center;
  background: linear-gradient(180deg, rgba(30, 34, 22, 0.98), rgba(15, 18, 11, 0.98));
  border: 1px solid var(--amber);
  border-radius: 18px;
  box-shadow: 0 16px 44px rgba(0, 0, 0, 0.6);
  overflow: hidden;
  animation: news-pop 0.28s cubic-bezier(0.2, 0.9, 0.3, 1.15);
}
@keyframes news-pop {
  from {
    opacity: 0;
    transform: translateY(14px) scale(0.96);
  }
}
/* мягкое янтарное свечение сверху — «событие» */
.news-glow {
  position: absolute;
  top: -90px;
  left: 50%;
  width: 240px;
  height: 240px;
  transform: translateX(-50%);
  background: radial-gradient(circle, rgba(242, 165, 12, 0.28), transparent 65%);
  pointer-events: none;
}
.news-kicker {
  position: relative;
  font-size: 8px;
  letter-spacing: 0.18em;
  color: var(--amber);
}
.news-emo {
  position: relative;
  font-size: 40px;
  line-height: 1;
  margin: 8px 0 2px;
  filter: drop-shadow(0 3px 8px rgba(0, 0, 0, 0.5));
}
.news-title {
  position: relative;
  font-size: 24px;
  letter-spacing: 0.02em;
  color: var(--ink);
}
.news-lead {
  position: relative;
  margin: 8px auto 0;
  max-width: 280px;
  font-size: 13.5px;
  line-height: 1.5;
  color: var(--ink-dim);
}
.news-rows {
  position: relative;
  margin: 16px 0 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.news-row {
  padding: 10px 12px;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--ink);
  text-align: left;
  background: rgba(242, 165, 12, 0.08);
  border: 1px solid rgba(242, 165, 12, 0.22);
  border-radius: 10px;
}
.news-tiers {
  position: relative;
  font-size: 8.5px;
  line-height: 1.7;
  letter-spacing: 0.04em;
  color: var(--ink-faint);
  margin-bottom: 16px;
}
.news-cta {
  position: relative;
  width: 100%;
  padding: 13px 14px;
  font-size: 16px;
}
.news-link {
  position: relative;
  display: block;
  width: 100%;
  margin-top: 10px;
  padding: 6px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ink-faint);
  background: transparent;
  border: none;
  cursor: pointer;
}
.news-link:active {
  color: var(--ink-dim);
}
</style>
