<script setup lang="ts">
// 界面层：已发车的冻结装车清单。支持版本切换核对、勾选核对、补签另存原因版本。
import { computed, ref } from "vue";
import type { Manifest } from "../types";
import { useDockStore } from "../data/dockStore";
import { formatDateTime } from "../utils/time";

const props = defineProps<{ manifest: Manifest }>();

const store = useDockStore();
const activeVersionNo = ref(props.manifest.versions[props.manifest.versions.length - 1].version);
const showResign = ref(false);
const reason = ref("");
const resignError = ref("");

const activeVersion = computed(
  () => props.manifest.versions.find((v) => v.version === activeVersionNo.value) ?? props.manifest.versions[0]
);

const checkedCount = computed(
  () => activeVersion.value.items.filter((it) => store.isChecked(props.manifest.id, activeVersion.value.version, it.orderId)).length
);

function doResign() {
  resignError.value = "";
  if (!reason.value.trim()) {
    resignError.value = "请填写补签原因";
    return;
  }
  store.resigned(props.manifest.id, reason.value);
  activeVersionNo.value = props.manifest.versions.length;
  reason.value = "";
  showResign.value = false;
}
</script>

<template>
  <article class="manifest-card">
    <header class="wave-head">
      <div>
        <h3>
          {{ manifest.station }} · {{ manifest.zone }}
          <span class="frozen-tag">第 {{ manifest.waveNo }} 波 · 已冻结</span>
        </h3>
        <p class="wave-no">发车于 {{ formatDateTime(manifest.dispatchedAt) }} · 共 {{ activeVersion.items.length }} 单</p>
      </div>
      <span class="zone-badge" :class="`zone-${manifest.zone}`">{{ manifest.zone }}</span>
    </header>

    <div class="version-bar">
      <label class="version-select">
        清单版本
        <select v-model.number="activeVersionNo">
          <option v-for="v in manifest.versions" :key="v.version" :value="v.version">
            v{{ v.version }} {{ v.kind }}（{{ formatDateTime(v.createdAt) }}）
          </option>
        </select>
      </label>
      <span class="check-progress">沿波次核对 {{ checkedCount }}/{{ activeVersion.items.length }}</span>
      <button class="secondary" type="button" @click="showResign = !showResign">
        {{ showResign ? "取消补签" : "补签" }}
      </button>
    </div>

    <p class="version-reason">
      <strong>v{{ activeVersion.version }} {{ activeVersion.kind }}：</strong>{{ activeVersion.reason }}
    </p>

    <div v-if="showResign" class="resign-box">
      <p class="panel-hint">清单已冻结不可改动；补签会把当前装车序另存为一个原因版本，旧单保留可查。</p>
      <textarea v-model="reason" placeholder="补签原因，如：温控记录补传 / 现场改派 / 客户改约" />
      <p v-if="resignError" class="form-error">{{ resignError }}</p>
      <button type="button" @click="doResign">另存补签版本</button>
    </div>

    <table class="wave-table manifest-table">
      <thead>
        <tr>
          <th>装车序</th>
          <th>订单号</th>
          <th>承诺窗口</th>
          <th>到站</th>
          <th>收货人</th>
          <th>核对</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="it in activeVersion.items" :key="it.orderId">
          <td><span class="seq-badge">{{ it.loadingSeq }}</span></td>
          <td>{{ it.code }}</td>
          <td>{{ it.windowStart }}–{{ it.windowEnd }}</td>
          <td>{{ formatDateTime(it.arrivedAt) }}</td>
          <td>{{ it.consignee || "—" }}</td>
          <td>
            <input
              class="check-box"
              type="checkbox"
              :checked="store.isChecked(manifest.id, activeVersion.version, it.orderId)"
              @change="store.toggleCheck(manifest.id, activeVersion.version, it.orderId)"
            />
          </td>
        </tr>
      </tbody>
    </table>
  </article>
</template>
