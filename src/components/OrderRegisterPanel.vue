<script setup lang="ts">
// 界面层：订单登记表单。只负责采集和展示错误，校验/入库由数据层转交判定层完成。
import { reactive, ref } from "vue";
import type { OrderDraft } from "../types";
import { TEMP_ZONES } from "../types";
import { useDockStore } from "../data/dockStore";
import { toLocalDatetimeInput } from "../utils/time";

const emit = defineEmits<{ registered: [] }>();

const store = useDockStore();

const blank = (): OrderDraft => ({
  code: "",
  station: "",
  zone: "常温",
  arrivedAt: toLocalDatetimeInput(new Date()),
  windowStart: "",
  windowEnd: "",
  consignee: ""
});

const form = reactive<OrderDraft>(blank());
const error = ref("");
const justSaved = ref(false);

const stationOptions = store.stations;

function submit() {
  error.value = "";
  const message = store.register({ ...form });
  if (message) {
    // 拦截时保留全部录入内容，仅提示问题字段
    error.value = message;
    return;
  }
  const keepStation = form.station;
  const keepZone = form.zone;
  Object.assign(form, blank(), { station: keepStation, zone: keepZone });
  justSaved.value = true;
  emit("registered");
  window.setTimeout(() => (justSaved.value = false), 2000);
}
</script>

<template>
  <form class="panel" @submit.prevent="submit">
    <h2>订单登记</h2>
    <p class="panel-hint">登记到站时刻、温区与承诺送达窗口，按站点与温区自动归入波次。</p>
    <div class="form-grid">
      <label>
        订单号
        <input v-model="form.code" placeholder="如 YD-5001" />
      </label>
      <label>
        驿站站点
        <input v-model="form.station" list="station-options" placeholder="选择或输入站点" />
        <datalist id="station-options">
          <option v-for="s in stationOptions" :key="s" :value="s" />
        </datalist>
      </label>
      <div class="form-row">
        <label>
          温区
          <select v-model="form.zone">
            <option v-for="z in TEMP_ZONES" :key="z" :value="z">{{ z }}</option>
          </select>
        </label>
        <label>
          到站时刻
          <input v-model="form.arrivedAt" type="datetime-local" />
        </label>
      </div>
      <div class="form-row">
        <label>
          窗口起
          <input v-model="form.windowStart" placeholder="HH:mm" maxlength="5" />
        </label>
        <label>
          窗口止
          <input v-model="form.windowEnd" placeholder="HH:mm" maxlength="5" />
        </label>
      </div>
      <label>
        收货人
        <input v-model="form.consignee" placeholder="选填" />
      </label>
      <p v-if="error" class="form-error">{{ error }}</p>
      <p v-else-if="justSaved" class="form-ok">已登记，归入对应站点温区波次</p>
      <button type="submit">登记入波</button>
    </div>
  </form>
</template>
