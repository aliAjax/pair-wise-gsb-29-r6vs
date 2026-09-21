<script setup lang="ts">
// 界面层：规则参数维护。参数由数据层持久化、判定层消费，本组件只负责录入。
import { reactive, watch } from "vue";
import { useDockStore } from "../data/dockStore";
import { DEFAULT_RULES } from "../domain/rules";

const store = useDockStore();

const draft = reactive({
  waveCapacity: store.rules.waveCapacity,
  cold: store.rules.coldDwellLimit.冷藏,
  frozen: store.rules.coldDwellLimit.冷冻
});

watch(
  () => [draft.waveCapacity, draft.cold, draft.frozen],
  ([capacity, cold, frozen]) => {
    store.updateRules({
      waveCapacity: Number(capacity) || DEFAULT_RULES.waveCapacity,
      coldDwellLimit: {
        冷藏: Number(cold) || DEFAULT_RULES.coldDwellLimit.冷藏,
        冷冻: Number(frozen) || DEFAULT_RULES.coldDwellLimit.冷冻
      }
    });
  }
);
</script>

<template>
  <section class="panel rules-panel">
    <h2>发车规则</h2>
    <div class="rules-grid">
      <label>
        波次容量（单/波）
        <input v-model.number="draft.waveCapacity" type="number" min="1" step="1" />
      </label>
      <label>
        冷藏滞留上限（分钟）
        <input v-model.number="draft.cold" type="number" min="1" step="1" />
      </label>
      <label>
        冷冻滞留上限（分钟）
        <input v-model.number="draft.frozen" type="number" min="1" step="1" />
      </label>
    </div>
    <p class="panel-hint">
      容量超限、冷链滞留超上限、送达窗口倒序，任一冲突都会让整批发车停住，待发订单保留不丢。
    </p>
  </section>
</template>
