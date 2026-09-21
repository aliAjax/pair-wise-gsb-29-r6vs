<script setup lang="ts">
// 界面层：待发波次卡片。实时调用判定层纯函数预览冲突；发车动作走数据层。
import { computed, onUnmounted, ref } from "vue";
import type { WaveGroup } from "../domain/rules";
import { checkWave } from "../domain/rules";
import { useDockStore } from "../data/dockStore";
import { dwellMinutes, formatTime } from "../utils/time";

const props = defineProps<{ wave: WaveGroup }>();

const store = useDockStore();
const now = ref(Date.now());
const timer = window.setInterval(() => (now.value = Date.now()), 20000);
onUnmounted(() => window.clearInterval(timer));

const waveNo = computed(
  () => store.manifests.filter((m) => m.waveKey === props.wave.waveKey).length + 1
);

// 始终实时调用判定层：撤回订单或调整规则后冲突状态立即重算
const check = computed(() =>
  checkWave({
    station: props.wave.station,
    zone: props.wave.zone,
    orders: props.wave.orders,
    dispatchedCount: waveNo.value - 1,
    rules: store.rules,
    now: now.value
  })
);

const activeConflicts = computed(() => check.value.conflicts);
const isBlocked = computed(() => check.value.blocked);

const conflictOrderIds = computed(() => new Set(activeConflicts.value.flatMap((c) => c.orderIds)));

const codeLabel: Record<string, string> = {
  CAPACITY: "容量",
  COLD_DWELL: "冷链滞留",
  WINDOW_ORDER: "窗口倒序"
};

function dwell(o: (typeof props.wave.orders)[number]): number {
  return dwellMinutes(o.arrivedAt, now.value);
}

function dispatch() {
  store.dispatchWave(props.wave.station, props.wave.zone);
}
</script>

<template>
  <article class="wave-card" :class="{ blocked: isBlocked }">
    <header class="wave-head">
      <div>
        <h3>{{ wave.station }} · {{ wave.zone }}</h3>
        <p class="wave-no">第 {{ waveNo }} 波 · 待发 {{ wave.orders.length }} 单</p>
      </div>
      <span class="zone-badge" :class="`zone-${wave.zone}`">{{ wave.zone }}</span>
    </header>

    <div v-if="isBlocked" class="conflict-box">
      <p class="conflict-title">整批发车停住 — {{ wave.station }} 第 {{ waveNo }} 波（{{ wave.zone }}）</p>
      <div v-for="c in activeConflicts" :key="c.code" class="conflict-item">
        <span class="conflict-tag" :class="`tag-${c.code}`">{{ codeLabel[c.code] }}</span>
        <span>{{ c.message }}</span>
      </div>
      <p class="conflict-orders">
        涉及订单：{{ wave.orders.filter((o) => conflictOrderIds.has(o.id)).map((o) => o.code).join("、") }}
      </p>
    </div>

    <table class="wave-table">
      <thead>
        <tr>
          <th>订单号</th>
          <th>到站</th>
          <th>滞留</th>
          <th>承诺窗口</th>
          <th>收货人</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="o in wave.orders" :key="o.id" :class="{ hit: conflictOrderIds.has(o.id) }">
          <td>{{ o.code }}</td>
          <td>{{ formatTime(o.arrivedAt) }}</td>
          <td>
            <span v-if="wave.zone !== '常温'">{{ dwell(o) }} 分</span>
            <span v-else class="muted">—</span>
          </td>
          <td>{{ o.windowStart }}–{{ o.windowEnd }}</td>
          <td>{{ o.consignee || "—" }}</td>
          <td>
            <button class="link-danger" type="button" @click="store.removeOrder(o.id)">撤回</button>
          </td>
        </tr>
      </tbody>
    </table>

    <footer class="wave-foot">
      <p v-if="isBlocked" class="foot-warn">请处理冲突（撤回订单或调整规则）后再发车，录入内容已保留</p>
      <p v-else class="foot-ok">规则校验通过，可冻结装车清单并发车</p>
      <button type="button" :disabled="isBlocked" @click="dispatch">整批发车 · 冻结清单</button>
    </footer>
  </article>
</template>
