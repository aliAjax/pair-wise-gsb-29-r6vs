<script setup lang="ts">
/**
 * 界面层：只负责渲染与交互。
 * 数据结构见 domain/types.ts，冲突判定见 domain/rules.ts，持久化见 data/store.ts。
 */
import { computed, reactive, ref } from "vue";
import type { DockSnapshot, Manifest, ManifestEntry, Order, TempZone, Wave } from "./domain/types";
import { STATIONS, TEMP_ZONES } from "./domain/types";
import { checkAllWaves } from "./domain/rules";
import {
  createId,
  departWave,
  loadSnapshot,
  resetSnapshot,
  saveSnapshot,
  supplementManifest,
} from "./data/store";

const snapshot = ref<DockSnapshot>(loadSnapshot());

function persist() {
  saveSnapshot(snapshot.value);
}

/* ---------- 展示工具 ---------- */
function pad(n: number) {
  return String(n).padStart(2, "0");
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "-" : `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "-"
    : `${d.getMonth() + 1}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const orderById = computed(() => new Map(snapshot.value.orders.map((o) => [o.id, o])));
function codeOf(id: string) {
  return orderById.value.get(id)?.code ?? id;
}
function ordersOf(wave: Wave): Order[] {
  return wave.orderIds
    .map((id) => orderById.value.get(id))
    .filter((o): o is Order => Boolean(o));
}

/* ---------- 判定结果（全部来自 rules.ts） ---------- */
const conflicts = computed(() => checkAllWaves(snapshot.value.waves, snapshot.value.orders));
const blocked = computed(() => conflicts.value.length > 0);
const conflictOrderIds = computed(() => new Set(conflicts.value.flatMap((c) => c.orderIds)));
function waveConflicts(waveId: string) {
  return conflicts.value.filter((c) => c.waveId === waveId);
}

/* ---------- 派生数据 ---------- */
const pendingWaves = computed(() => snapshot.value.waves.filter((w) => w.status === "待发"));
const departedCount = computed(() => snapshot.value.waves.filter((w) => w.status === "已发车").length);
const assignedIds = computed(() => new Set(snapshot.value.waves.flatMap((w) => w.orderIds)));
const poolOrders = computed(() => snapshot.value.orders.filter((o) => !assignedIds.value.has(o.id)));

const stationGroups = computed(() =>
  STATIONS.map((station) => ({
    station,
    waves: snapshot.value.waves
      .filter((w) => w.station === station)
      .map((wave) => ({
        wave,
        manifest: snapshot.value.manifests.find((m) => m.waveId === wave.id),
      })),
  })).filter((g) => g.waves.length > 0)
);

const metricLabels = ["在录订单", "待发波次", "已发车波次", "当前冲突"];
const metrics = computed(() => [
  snapshot.value.orders.length,
  pendingWaves.value.length,
  departedCount.value,
  conflicts.value.length,
]);

/* ---------- 订单登记（冲突只拦发车，不拦登记） ---------- */
const orderForm = reactive({
  code: "",
  station: STATIONS[0],
  zone: TEMP_ZONES[0] as TempZone,
  arrivedAt: toLocalInput(new Date().toISOString()),
  windowStart: "",
  windowEnd: "",
  address: "",
  note: "",
});

function registerOrder() {
  const order: Order = {
    id: createId("o"),
    code: orderForm.code.trim(),
    station: orderForm.station,
    zone: orderForm.zone,
    arrivedAt: new Date(orderForm.arrivedAt).toISOString(),
    windowStart: orderForm.windowStart,
    windowEnd: orderForm.windowEnd,
    address: orderForm.address.trim(),
    note: orderForm.note.trim(),
    createdAt: new Date().toISOString(),
  };
  snapshot.value.orders.push(order);
  // 按站点 + 温区归入最近的待发波次；无匹配则进入待入波池
  const target = [...pendingWaves.value]
    .reverse()
    .find((w) => w.station === order.station && w.zone === order.zone);
  if (target) target.orderIds.push(order.id);
  persist();
  orderForm.code = "";
  orderForm.address = "";
  orderForm.note = "";
}

/* ---------- 波次维护 ---------- */
const waveForm = reactive({
  station: STATIONS[0],
  zone: TEMP_ZONES[0] as TempZone,
  capacity: 6,
  dwellLimitMin: 90,
  plannedDepartAt: toLocalInput(new Date(Date.now() + 3600000).toISOString()),
});

function createWave() {
  const count = snapshot.value.waves.filter(
    (w) => w.station === waveForm.station && w.zone === waveForm.zone
  ).length;
  const wave: Wave = {
    id: createId("w"),
    name: `${waveForm.station}·${waveForm.zone}·W${count + 1}`,
    station: waveForm.station,
    zone: waveForm.zone,
    capacity: Math.max(1, Number(waveForm.capacity) || 1),
    dwellLimitMin: waveForm.zone === "常温" ? 0 : Math.max(0, Number(waveForm.dwellLimitMin) || 0),
    plannedDepartAt: new Date(waveForm.plannedDepartAt).toISOString(),
    status: "待发",
    orderIds: [],
    createdAt: new Date().toISOString(),
  };
  // 自动收入同站点同温区的待入波订单
  wave.orderIds = poolOrders.value
    .filter((o) => o.station === wave.station && o.zone === wave.zone)
    .map((o) => o.id);
  snapshot.value.waves.push(wave);
  persist();
}

function moveOrder(wave: Wave, index: number, delta: number) {
  const next = index + delta;
  if (next < 0 || next >= wave.orderIds.length) return;
  const ids = wave.orderIds;
  [ids[index], ids[next]] = [ids[next], ids[index]];
  persist();
}

function removeFromWave(wave: Wave, orderId: string) {
  wave.orderIds = wave.orderIds.filter((id) => id !== orderId);
  persist();
}

function matchingWaves(order: Order) {
  return pendingWaves.value.filter((w) => w.station === order.station && w.zone === order.zone);
}

function onAssign(orderId: string, event: Event) {
  const waveId = (event.target as HTMLSelectElement).value;
  const wave = snapshot.value.waves.find((w) => w.id === waveId);
  if (!wave || wave.status !== "待发") return;
  wave.orderIds.push(orderId);
  persist();
}

function removeOrder(orderId: string) {
  snapshot.value.orders = snapshot.value.orders.filter((o) => o.id !== orderId);
  persist();
}

function removeWave(wave: Wave) {
  if (wave.status !== "待发" || wave.orderIds.length > 0) return;
  snapshot.value.waves = snapshot.value.waves.filter((w) => w.id !== wave.id);
  persist();
}

function onWaveField(wave: Wave, key: "capacity" | "dwellLimitMin" | "plannedDepartAt", event: Event) {
  const value = (event.target as HTMLInputElement).value;
  if (key === "plannedDepartAt") {
    const t = new Date(value);
    if (!Number.isNaN(t.getTime())) wave.plannedDepartAt = t.toISOString();
  } else {
    wave[key] = Math.max(0, Number(value) || 0);
  }
  persist();
}

/* ---------- 整批发车：任一冲突存在则整批停住 ---------- */
function departAll() {
  if (blocked.value || pendingWaves.value.length === 0) return;
  const now = new Date().toISOString();
  let next = snapshot.value;
  for (const wave of pendingWaves.value) {
    next = departWave(next, wave.id, now);
  }
  snapshot.value = next;
  persist();
}

/* ---------- 补签：另存原因版本，旧版保留 ---------- */
const supp = reactive<Record<string, { reason: string; picks: string[] }>>({});
function suppState(waveId: string) {
  if (!supp[waveId]) supp[waveId] = { reason: "", picks: [] };
  return supp[waveId];
}

const manifestView = reactive<Record<string, number>>({});
function viewVersion(waveId: string, manifest: Manifest) {
  return (
    manifest.versions.find((v) => v.version === manifestView[waveId]) ??
    manifest.versions[manifest.versions.length - 1]
  );
}

function unsignedEntries(manifest: Manifest): ManifestEntry[] {
  return manifest.versions[manifest.versions.length - 1].entries.filter((e) => !e.signed);
}

function submitSupplement(wave: Wave) {
  const manifest = snapshot.value.manifests.find((m) => m.waveId === wave.id);
  const state = suppState(wave.id);
  if (!manifest || !state.reason.trim() || state.picks.length === 0) return;
  const latest = manifest.versions[manifest.versions.length - 1];
  const entries: ManifestEntry[] = latest.entries.map((e) =>
    state.picks.includes(e.orderId) ? { ...e, signed: true } : e
  );
  snapshot.value = supplementManifest(
    snapshot.value,
    wave.id,
    state.reason.trim(),
    entries,
    new Date().toISOString()
  );
  manifestView[wave.id] = manifest.versions.length + 1;
  state.reason = "";
  state.picks = [];
  persist();
}

function resetDemo() {
  snapshot.value = resetSnapshot();
  persist();
}
</script>

<template>
  <main class="app">
    <div class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">物流行业前端最小闭环</p>
          <h1>驿站波次装车台</h1>
          <p class="subtitle">
            订单登记到站时刻、温区与承诺送达窗口，按站点与温区分波；容量超限、冷链滞留超限或送达窗口倒序时整批发车停住并指出冲突，发车后清单冻结、补签另存版本。
          </p>
        </div>
        <div class="stack">
          <span class="tag">Vue3</span>
          <span class="tag">Vite</span>
          <span class="tag">TypeScript</span>
          <span class="tag">localStorage</span>
        </div>
      </header>

      <section class="metrics">
        <article v-for="(label, index) in metricLabels" :key="label" class="metric">
          <span>{{ label }}</span>
          <strong :class="{ 'danger-text': label === '当前冲突' && metrics[index] > 0 }">
            {{ metrics[index] }}
          </strong>
        </article>
      </section>

      <section class="depart-bar">
        <div>
          <strong>本批待发 {{ pendingWaves.length }} 个波次</strong>
          <p v-if="blocked" class="hint danger-text">
            存在 {{ conflicts.length }} 项冲突，整批发车已停住；已录入内容全部保留。
          </p>
          <p v-else class="hint">无冲突，可整批发车。</p>
        </div>
        <div class="actions">
          <button type="button" :disabled="blocked || pendingWaves.length === 0" @click="departAll">
            整批发车
          </button>
          <button type="button" class="secondary" @click="resetDemo">重置演示数据</button>
        </div>
      </section>

      <section v-if="blocked" class="conflict-banner">
        <h2>发车冲突（{{ conflicts.length }}）</h2>
        <ul>
          <li v-for="(c, i) in conflicts" :key="i">
            <span class="badge warn">{{ c.type }}</span>
            <strong>{{ c.station }} / {{ c.waveName }}</strong>
            <span>订单：{{ c.orderIds.map(codeOf).join("、") }}</span>
            <span class="hint">{{ c.detail }}</span>
          </li>
        </ul>
      </section>

      <section class="workspace">
        <div class="side">
          <form class="panel" @submit.prevent="registerOrder">
            <h2>订单登记</h2>
            <div class="form-grid">
              <label>
                单号
                <input v-model="orderForm.code" required placeholder="如 D-1003" />
              </label>
              <label>
                站点
                <select v-model="orderForm.station">
                  <option v-for="s in STATIONS" :key="s">{{ s }}</option>
                </select>
              </label>
              <label>
                温区
                <select v-model="orderForm.zone">
                  <option v-for="z in TEMP_ZONES" :key="z">{{ z }}</option>
                </select>
              </label>
              <label>
                到站时刻
                <input v-model="orderForm.arrivedAt" type="datetime-local" required />
              </label>
              <label>
                承诺窗口起
                <input v-model="orderForm.windowStart" type="time" required />
              </label>
              <label>
                承诺窗口止
                <input v-model="orderForm.windowEnd" type="time" required />
              </label>
              <label>
                地址
                <input v-model="orderForm.address" required placeholder="送达地址" />
              </label>
              <label>
                备注
                <textarea v-model="orderForm.note" placeholder="选填" />
              </label>
              <button type="submit">登记入站</button>
            </div>
          </form>

          <form class="panel" @submit.prevent="createWave">
            <h2>新建波次</h2>
            <div class="form-grid">
              <label>
                站点
                <select v-model="waveForm.station">
                  <option v-for="s in STATIONS" :key="s">{{ s }}</option>
                </select>
              </label>
              <label>
                温区
                <select v-model="waveForm.zone">
                  <option v-for="z in TEMP_ZONES" :key="z">{{ z }}</option>
                </select>
              </label>
              <label>
                容量（单）
                <input v-model="waveForm.capacity" type="number" min="1" required />
              </label>
              <label v-if="waveForm.zone !== '常温'">
                冷链滞留上限（分钟）
                <input v-model="waveForm.dwellLimitMin" type="number" min="0" required />
              </label>
              <label>
                计划发车
                <input v-model="waveForm.plannedDepartAt" type="datetime-local" required />
              </label>
              <button type="submit">开波</button>
            </div>
          </form>

          <section class="panel">
            <h2>待入波订单（{{ poolOrders.length }}）</h2>
            <p class="hint">无匹配待发波次的订单在此等待；新建同站点同温区波次会自动收入。</p>
            <div v-if="poolOrders.length === 0" class="empty">无待入波订单</div>
            <article v-for="order in poolOrders" :key="order.id" class="pool-item">
              <div>
                <strong>{{ order.code }}</strong>
                <span class="hint">
                  {{ order.station }} · {{ order.zone }} · 窗口 {{ order.windowStart }}-{{ order.windowEnd }} · 到站 {{ fmtTime(order.arrivedAt) }}
                </span>
              </div>
              <div class="actions">
                <select @change="onAssign(order.id, $event)">
                  <option value="">指定波次…</option>
                  <option v-for="w in matchingWaves(order)" :key="w.id" :value="w.id">{{ w.name }}</option>
                </select>
                <button type="button" class="tiny danger" @click="removeOrder(order.id)">删除</button>
              </div>
            </article>
          </section>
        </div>

        <div class="main-col">
          <div v-if="stationGroups.length === 0" class="empty">暂无波次，请先新建波次。</div>

          <section v-for="group in stationGroups" :key="group.station" class="station-group">
            <h2>{{ group.station }}</h2>

            <article
              v-for="item in group.waves"
              :key="item.wave.id"
              class="wave-card"
              :class="{ departed: item.wave.status === '已发车' }"
            >
              <header class="wave-head">
                <div>
                  <strong>{{ item.wave.name }}</strong>
                  <span class="status">{{ item.wave.status }}</span>
                </div>
                <div v-if="item.wave.status === '待发'" class="wave-meta">
                  <label>
                    容量
                    <input
                      type="number"
                      min="1"
                      :value="item.wave.capacity"
                      @change="onWaveField(item.wave, 'capacity', $event)"
                    />
                  </label>
                  <label v-if="item.wave.zone !== '常温'">
                    滞留上限(分)
                    <input
                      type="number"
                      min="0"
                      :value="item.wave.dwellLimitMin"
                      @change="onWaveField(item.wave, 'dwellLimitMin', $event)"
                    />
                  </label>
                  <label>
                    计划发车
                    <input
                      type="datetime-local"
                      :value="toLocalInput(item.wave.plannedDepartAt)"
                      @change="onWaveField(item.wave, 'plannedDepartAt', $event)"
                    />
                  </label>
                </div>
              </header>

              <template v-if="item.wave.status === '待发'">
                <p class="hint">已装 {{ item.wave.orderIds.length }} / {{ item.wave.capacity }} 单 · 按窗口结束升序装车</p>
                <ul class="order-list">
                  <li
                    v-for="(order, idx) in ordersOf(item.wave)"
                    :key="order.id"
                    class="order-row"
                    :class="{ conflict: conflictOrderIds.has(order.id) }"
                  >
                    <span class="seq">{{ idx + 1 }}</span>
                    <div>
                      <strong>{{ order.code }}</strong>
                      <span>窗口 {{ order.windowStart }}-{{ order.windowEnd }}</span>
                      <span>到站 {{ fmtTime(order.arrivedAt) }}</span>
                      <span>{{ order.address }}</span>
                      <span v-if="order.note" class="hint">{{ order.note }}</span>
                    </div>
                    <div class="actions">
                      <button type="button" class="tiny secondary" :disabled="idx === 0" @click="moveOrder(item.wave, idx, -1)">上移</button>
                      <button type="button" class="tiny secondary" :disabled="idx === item.wave.orderIds.length - 1" @click="moveOrder(item.wave, idx, 1)">下移</button>
                      <button type="button" class="tiny danger" @click="removeFromWave(item.wave, order.id)">移出</button>
                    </div>
                  </li>
                </ul>
                <div v-if="waveConflicts(item.wave.id).length" class="wave-conflicts">
                  <p v-for="(c, i) in waveConflicts(item.wave.id)" :key="i">⚠ {{ c.type }}：{{ c.detail }}</p>
                </div>
                <button
                  v-if="item.wave.orderIds.length === 0"
                  type="button"
                  class="tiny secondary"
                  @click="removeWave(item.wave)"
                >
                  撤销空波次
                </button>
              </template>

              <template v-else-if="item.manifest">
                <p class="hint">
                  清单已冻结 · 发车 {{ fmtDateTime(item.manifest.departedAt) }} · 共 {{ item.manifest.versions.length }} 版
                </p>
                <div class="version-tabs">
                  <button
                    v-for="v in item.manifest.versions"
                    :key="v.version"
                    type="button"
                    class="tiny"
                    :class="{ secondary: viewVersion(item.wave.id, item.manifest).version !== v.version }"
                    @click="manifestView[item.wave.id] = v.version"
                  >
                    v{{ v.version }} {{ v.kind }}
                  </button>
                </div>
                <p class="hint">
                  {{ viewVersion(item.wave.id, item.manifest).kind }} ·
                  {{ viewVersion(item.wave.id, item.manifest).reason }} ·
                  {{ fmtDateTime(viewVersion(item.wave.id, item.manifest).createdAt) }}
                </p>
                <ul class="order-list">
                  <li
                    v-for="(e, idx) in viewVersion(item.wave.id, item.manifest).entries"
                    :key="e.orderId"
                    class="order-row"
                  >
                    <span class="seq">{{ idx + 1 }}</span>
                    <div>
                      <strong>{{ e.code }}</strong>
                      <span>窗口 {{ e.windowStart }}-{{ e.windowEnd }}</span>
                      <span>{{ e.address }}</span>
                      <span v-if="e.note" class="hint">{{ e.note }}</span>
                    </div>
                    <span class="badge" :class="e.signed ? 'ok' : 'muted'">
                      {{ e.signed ? "已补签" : "待签收" }}
                    </span>
                  </li>
                </ul>

                <form
                  v-if="unsignedEntries(item.manifest).length"
                  class="supp"
                  @submit.prevent="submitSupplement(item.wave)"
                >
                  <p class="hint"><strong>补签</strong>：另存为新版本，旧版清单原样保留。</p>
                  <label v-for="e in unsignedEntries(item.manifest)" :key="e.orderId" class="check">
                    <input v-model="suppState(item.wave.id).picks" type="checkbox" :value="e.orderId" />
                    {{ e.code }}
                  </label>
                  <input v-model="suppState(item.wave.id).reason" required placeholder="补签原因（必填）" />
                  <div class="actions">
                    <button type="submit" class="tiny" :disabled="suppState(item.wave.id).picks.length === 0">
                      补签存档
                    </button>
                  </div>
                </form>
                <p v-else class="hint">全部订单已签收。</p>
              </template>
            </article>
          </section>
        </div>
      </section>
    </div>
  </main>
</template>
