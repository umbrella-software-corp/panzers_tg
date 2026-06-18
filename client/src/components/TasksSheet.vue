<script setup>
// Задачи дня: три цели с прогрессом и наградой; «Забрать» начисляет
// кредиты/жетоны. Ротация задач — по дате, общая для всех (meta.tasksOfDay).
import { computed, ref } from 'vue'
import { dailyTasksList, claimTask } from '../store.js'
import { track } from '../analytics.js'
import { t } from '../i18n.js'
import PzIcon from './ui/PzIcon.vue'

const emit = defineEmits(['close'])
const bump = ref(0)
const tasks = computed(() => (bump.value, dailyTasksList()))

async function claim(t) {
  if (await claimTask(t.id)) {
    track('task_reward_claimed', {
      task_id: t.id,
      goal: t.goal,
      progress: t.progress,
      credits: t.credits || 0,
      tokens: t.tokens || 0,
    })
    bump.value++
  }
}
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <div class="pz-plate pz-brackets sheet" style="--bk: var(--amber)">
      <div class="pz-stencil-h" style="justify-content: center">{{ t('tasks.title') }}</div>
      <div style="font-size: 11px; color: var(--ink-dim); text-align: center; font-weight: 500; margin-top: -4px">
        {{ t('tasks.info') }}
      </div>

      <div v-for="task in tasks" :key="task.id" class="task" :style="{ opacity: task.claimed ? 0.55 : 1 }">
        <div style="flex: 1; min-width: 0">
          <div style="font-size: 12.5px; font-weight: 600" :style="{ color: task.done ? 'var(--ink)' : 'var(--ink)' }">{{ task.label }}</div>
          <div class="bar"><b :style="{ width: (task.progress / task.goal) * 100 + '%', background: task.done ? 'var(--green)' : 'var(--amber)' }"></b></div>
          <div style="font-size: 10.5px; color: var(--ink-dim); font-weight: 500; margin-top: 3px">
            {{ task.progress }} / {{ task.goal }}
          </div>
        </div>
        <span v-if="task.claimed" class="pz-chip" style="color: var(--green); font-size: 10.5px">{{ t('tasks.claimed') }}</span>
        <button
          v-else-if="task.done"
          class="pz-btn2"
          style="padding: 7px 12px; font-size: 11px; gap: 4px; border-color: var(--green); color: var(--green)"
          @click="claim(task)"
        >
          {{ t('tasks.claim') }} <PzIcon :name="task.tokens ? 'token' : 'coin'" :size="12" /> {{ task.tokens || task.credits }}
        </button>
        <span v-else class="pz-chip" style="font-size: 10.5px; color: var(--ink-dim)">
          <PzIcon :name="task.tokens ? 'token' : 'coin'" :size="11" /> {{ task.tokens || task.credits }}
        </span>
      </div>

      <button class="pz-btn2" @click="emit('close')">{{ t('common.close') }}</button>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: absolute;
  inset: 0;
  z-index: 30;
  background: rgba(5, 7, 4, 0.7);
  backdrop-filter: blur(3px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
.sheet {
  width: 100%;
  max-width: 330px;
  padding: 18px 16px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  animation: pz-pop 0.25s ease;
}
.task {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.35);
}
.bar {
  height: 5px;
  margin-top: 6px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.1);
  overflow: hidden;
}
.bar b {
  display: block;
  height: 100%;
  transition: width 0.3s ease;
}
</style>
