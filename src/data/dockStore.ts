// 数据层：唯一负责 localStorage 读写与状态存放。
// 不在这里写判定逻辑——发车校验一律调用 domain/rules，界面只派发动作。

import { defineStore } from "pinia";
import { computed, ref } from "vue";
import type { Manifest, Order, OrderDraft, TempZone } from "../types";
import {
  DEFAULT_RULES,
  buildLoadingItems,
  checkWave,
  createManifest,
  groupPendingWaves,
  resignManifest,
  validateDraft,
  waveKey
} from "../domain/rules";
import type { Conflict, DockRules } from "../domain/rules";
import { seedManifests, seedOrders } from "./seed";
import { toIsoFromLocalInput, uid } from "../utils/time";

const STORAGE_KEY = "hxwlfront-15-wave-dock-v1";

interface PersistState {
  orders: Order[];
  manifests: Manifest[];
  rules: DockRules;
  checks: Record<string, boolean>; // 核对勾选：`<manifestId>:<version>:<orderId>`
}

function loadState(): PersistState {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return { orders: seedOrders(), manifests: seedManifests(), rules: { ...DEFAULT_RULES }, checks: {} };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<PersistState>;
    return {
      orders: parsed.orders ?? [],
      manifests: parsed.manifests ?? [],
      rules: { ...DEFAULT_RULES, ...(parsed.rules ?? {}) },
      checks: parsed.checks ?? {}
    };
  } catch {
    return { orders: [], manifests: [], rules: { ...DEFAULT_RULES }, checks: {} };
  }
}

export interface DispatchFailure {
  station: string;
  zone: TempZone;
  waveNo: number;
  conflicts: Conflict[];
}

export const useDockStore = defineStore("waveDock", () => {
  const initial = loadState();
  const orders = ref<Order[]>(initial.orders);
  const manifests = ref<Manifest[]>(initial.manifests);
  const rules = ref<DockRules>({ ...initial.rules });
  const checks = ref<Record<string, boolean>>({ ...initial.checks });
  /** 最近一次发车拦截结果，供界面定位 站点/波次/订单 */
  const lastBlock = ref<DispatchFailure | null>(null);

  function persist() {
    const state: PersistState = {
      orders: orders.value,
      manifests: manifests.value,
      rules: rules.value,
      checks: checks.value
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  const pendingWaves = computed(() => groupPendingWaves(orders.value));

  const stations = computed(() => {
    const set = new Set<string>();
    orders.value.forEach((o) => set.add(o.station));
    manifests.value.forEach((m) => set.add(m.station));
    return [...set].sort((a, b) => a.localeCompare(b, "zh"));
  });

  function orderCodeSet(excludeId?: string): Set<string> {
    const set = new Set<string>();
    for (const m of manifests.value) {
      m.versions[m.versions.length - 1].items.forEach((it) => set.add(it.code));
    }
    orders.value.forEach((o) => {
      if (o.id !== excludeId) set.add(o.code);
    });
    return set;
  }

  /** 登记：校验通过才入库；不通过返回错误信息，界面保留已录入内容 */
  function register(draft: OrderDraft): string | null {
    const error = validateDraft(draft, orderCodeSet());
    if (error) return error;
    orders.value = [
      {
        ...draft,
        code: draft.code.trim(),
        station: draft.station.trim(),
        id: uid("o"),
        arrivedAt: toIsoFromLocalInput(draft.arrivedAt),
        createdAt: new Date().toISOString()
      },
      ...orders.value
    ];
    persist();
    return null;
  }

  /** 撤回未发车订单（整单录入错误时使用；已冻结清单中的订单不受影响） */
  function removeOrder(id: string) {
    orders.value = orders.value.filter((o) => o.id !== id);
    persist();
  }

  /** 某 站点+温区 已发车的波次数，用于给待发波次编号 */
  function dispatchedCount(station: string, zone: TempZone): number {
    return manifests.value.filter((m) => m.waveKey === waveKey(station, zone)).length;
  }

  /**
   * 请求发车：调用判定层。
   * 通过 → 冻结清单、订单移出待发区；冲突 → 整批停住，订单原样保留并返回拦截明细。
   */
  function dispatchWave(station: string, zone: TempZone): DispatchFailure | null {
    const waveOrders = orders.value.filter(
      (o) => o.station === station && o.zone === zone
    );
    if (waveOrders.length === 0) return null;

    const result = checkWave({
      station,
      zone,
      orders: waveOrders,
      dispatchedCount: dispatchedCount(station, zone),
      rules: rules.value,
      now: Date.now()
    });

    if (result.blocked) {
      lastBlock.value = {
        station,
        zone,
        waveNo: result.waveNo,
        conflicts: result.conflicts
      };
      persist();
      return lastBlock.value;
    }

    const manifest = createManifest(
      { station, zone, orders: waveOrders, dispatchedCount: result.waveNo - 1, rules: rules.value, now: Date.now() },
      result,
      new Date().toISOString()
    );
    manifests.value = [manifest, ...manifests.value];
    const ids = new Set(waveOrders.map((o) => o.id));
    orders.value = orders.value.filter((o) => !ids.has(o.id));
    lastBlock.value = null;
    persist();
    return null;
  }

  /** 补签：冻结清单另存原因版本，旧版本保留 */
  function resign(manifestId: string, reason: string): boolean {
    const m = manifests.value.find((x) => x.id === manifestId);
    if (!m || !reason.trim()) return false;
    m.versions.push(resignManifest(m, reason, new Date().toISOString()));
    persist();
    return true;
  }

  function toggleCheck(manifestId: string, version: number, orderId: string) {
    const key = `${manifestId}:${version}:${orderId}`;
    if (checks.value[key]) delete checks.value[key];
    else checks.value[key] = true;
    persist();
  }

  function isChecked(manifestId: string, version: number, orderId: string): boolean {
    return Boolean(checks.value[`${manifestId}:${version}:${orderId}`]);
  }

  function updateRules(next: DockRules) {
    rules.value = {
      waveCapacity: Math.max(1, Math.floor(next.waveCapacity)),
      coldDwellLimit: {
        冷藏: Math.max(1, Math.floor(next.coldDwellLimit.冷藏)),
        冷冻: Math.max(1, Math.floor(next.coldDwellLimit.冷冻))
      }
    };
    persist();
  }

  return {
    orders,
    manifests,
    rules,
    lastBlock,
    pendingWaves,
    stations,
    register,
    removeOrder,
    dispatchWave,
    resigned: resign,
    toggleCheck,
    isChecked,
    updateRules,
    buildItems: buildLoadingItems
  };
});
