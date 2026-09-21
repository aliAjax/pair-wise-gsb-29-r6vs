<script setup lang="ts">
// 界面层入口：只做布局、筛选与指标汇总；数据在 data 层，判定在 domain 层。
import { computed, ref } from "vue";
import { useDockStore } from "./data/dockStore";
import { checkWave } from "./domain/rules";
import type { TempZone } from "./types";
import OrderRegisterPanel from "./components/OrderRegisterPanel.vue";
import RulesPanel from "./components/RulesPanel.vue";
import WaveCard from "./components/WaveCard.vue";
import ManifestCard from "./components/ManifestCard.vue";

const store = useDockStore();

const stationFilter = ref("全部站点");
const tab = ref<"pending" | "dispatched">("pending");

const filteredPendingWaves = computed(() =>
  stationFilter.value === "全部站点"
    ? store.pendingWaves
    : store.pendingWaves.filter((w) => w.station === stationFilter.value)
);

const filteredManifests = computed(() =>
  stationFilter.value === "全部站点"
    ? store.manifests
    : store.manifests.filter((m) => m.station === stationFilter.value)
);

const pendingCount = computed(() => store.orders.length);

// 指标统计用，判定仍以 domain 的 checkWave 为准
function checkBlocked(station: string, zone: TempZone): boolean {
  const waveOrders = store.orders.filter((o) => o.station === station && o.zone === zone);
  const result = checkWave({
    station,
    zone,
    orders: waveOrders,
    dispatchedCount: store.manifests.filter((m) => m.station === station && m.zone === zone).length,
    rules: store.rules,
    now: Date.now()
  });
  return result.blocked;
}

const blockedCount = computed(
  () => store.pendingWaves.filter((w) => checkBlocked(w.station, w.zone)).length
);

const metrics = computed(() => [
  { label: "待发订单", value: pendingCount.value },
  { label: "被拦波次", value: blockedCount.value, warn: blockedCount.value > 0 },
  { label: "已冻结清单", value: store.manifests.length }
]);
</script>

<template>
  <main class="app">
    <div class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">物流 · 驿站装车作业</p>
          <h1>驿站波次装车台</h1>
          <p class="subtitle">
            订单登记到站时刻、温区与承诺送达窗口，按站点与温区分波；容量、冷链滞留或窗口倒序冲突时整批停住，发车后清单冻结、补签另存版本，重开页面仍可沿波次核对。
          </p>
        </div>
        <div class="stack">
          <span class="tag">Vue3</span>
          <span class="tag">TypeScript</span>
          <span class="tag">Pinia</span>
          <span class="tag">localStorage</span>
        </div>
      </header>

      <section class="metrics">
        <article v-for="m in metrics" :key="m.label" class="metric" :class="{ alert: m.warn }">
          <span>{{ m.label }}</span>
          <strong>{{ m.value }}</strong>
        </article>
      </section>

      <div class="layout">
        <div class="side">
          <OrderRegisterPanel />
          <RulesPanel />
        </div>

        <section class="dock-panel">
          <div class="toolbar">
            <div class="tabs">
              <button
                type="button"
                :class="{ active: tab === 'pending' }"
                @click="tab = 'pending'"
              >
                待发波次（{{ store.pendingWaves.length }}）
              </button>
              <button
                type="button"
                :class="{ active: tab === 'dispatched' }"
                @click="tab = 'dispatched'"
              >
                已冻结清单（{{ store.manifests.length }}）
              </button>
            </div>
            <select v-model="stationFilter">
              <option value="全部站点">全部站点</option>
              <option v-for="s in store.stations" :key="s" :value="s">{{ s }}</option>
            </select>
          </div>

          <div v-if="tab === 'pending'" class="card-list">
            <div v-if="filteredPendingWaves.length === 0" class="empty">
              当前筛选下没有待发波次，请到左侧登记订单
            </div>
            <WaveCard v-for="wave in filteredPendingWaves" :key="wave.waveKey" :wave="wave" />
          </div>

          <div v-else class="card-list">
            <div v-if="filteredManifests.length === 0" class="empty">还没有发车冻结的装车清单</div>
            <ManifestCard v-for="m in filteredManifests" :key="m.id" :manifest="m" />
          </div>
        </section>
      </div>
    </div>
  </main>
</template>
