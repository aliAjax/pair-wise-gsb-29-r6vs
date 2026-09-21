// 判定层：纯函数，不碰 localStorage / Pinia / DOM。
// 所有拦截规则集中在这里，规则调整不需要动数据层和界面层。

import type {
  LoadingItem,
  Manifest,
  ManifestVersion,
  Order,
  OrderDraft,
  TempZone
} from "../types";
import { ZONE_ORDER } from "../types";
import { toMinutes, uid } from "../utils/time";

/** 规则参数：由数据层保存、界面层维护，判定层只读取 */
export interface DockRules {
  /** 单波容量上限（单） */
  waveCapacity: number;
  /** 冷链滞留上限（分钟），按温区区分 */
  coldDwellLimit: Record<Exclude<TempZone, "常温">, number>;
}

export const DEFAULT_RULES: DockRules = {
  waveCapacity: 4,
  coldDwellLimit: { 冷藏: 40, 冷冻: 30 }
};

export type ConflictCode = "CAPACITY" | "COLD_DWELL" | "WINDOW_ORDER";

export interface Conflict {
  code: ConflictCode;
  message: string;
  orderIds: string[];
}

export interface WaveGroup {
  waveKey: string;
  station: string;
  zone: TempZone;
  orders: Order[];
}

export interface WaveCheckInput {
  station: string;
  zone: TempZone;
  orders: Order[];
  /** 该 站点+温区 已经发过的波次数（当前待发波次序号 = 它 + 1） */
  dispatchedCount: number;
  rules: DockRules;
  now: number;
}

export interface WaveCheckResult {
  waveKey: string;
  waveNo: number;
  blocked: boolean;
  conflicts: Conflict[];
}

export function waveKey(station: string, zone: TempZone): string {
  return `${station}｜${zone}`;
}

/** 待发订单按 站点 + 温区 归波，组内按到站先后排列 */
export function groupPendingWaves(orders: Order[]): WaveGroup[] {
  const map = new Map<string, WaveGroup>();
  for (const order of orders) {
    const key = waveKey(order.station, order.zone);
    let group = map.get(key);
    if (!group) {
      group = { waveKey: key, station: order.station, zone: order.zone, orders: [] };
      map.set(key, group);
    }
    group.orders.push(order);
  }
  const groups = [...map.values()];
  groups.forEach((g) => g.orders.sort((a, b) => a.arrivedAt.localeCompare(b.arrivedAt)));
  groups.sort(
    (a, b) => a.station.localeCompare(b.station, "zh") || ZONE_ORDER[a.zone] - ZONE_ORDER[b.zone]
  );
  return groups;
}

/** 送达排序：承诺窗口结束越早越先送；并列时窗口开始早的先送；再并列按到站先后 */
function deliveryRank(o: Order): [number, number, string] {
  return [toMinutes(o.windowEnd) ?? Number.MAX_SAFE_INTEGER, toMinutes(o.windowStart) ?? 0, o.arrivedAt];
}

function compareRank(a: Order, b: Order): number {
  const ra = deliveryRank(a);
  const rb = deliveryRank(b);
  if (ra[0] !== rb[0]) return ra[0] - rb[0];
  if (ra[1] !== rb[1]) return ra[1] - rb[1];
  return ra[2].localeCompare(rb[2]);
}

/**
 * 装车清单（未冻结）：送达排序的倒序即装车顺序——
 * 序号 1 最先装、压在最里面；序号最大的最晚装、靠车门、第一票送达。
 */
export function buildLoadingItems(orders: Order[]): LoadingItem[] {
  return [...orders]
    .sort(compareRank)
    .map((o, idx) => ({
      orderId: o.id,
      code: o.code,
      station: o.station,
      zone: o.zone,
      arrivedAt: o.arrivedAt,
      windowStart: o.windowStart,
      windowEnd: o.windowEnd,
      consignee: o.consignee,
      loadingSeq: orders.length - idx
    }))
    .sort((a, b) => a.loadingSeq - b.loadingSeq);
}

/** 登记内容的字段级校验，返回中文错误信息，合法返回 null */
export function validateDraft(draft: OrderDraft, existingCodes: Set<string>): string | null {
  if (!draft.code.trim()) return "订单号不能为空";
  if (existingCodes.has(draft.code.trim())) return `订单号 ${draft.code.trim()} 已登记，请勿重复`;
  if (!draft.station.trim()) return "站点不能为空";
  if (!draft.arrivedAt) return "请填写到站时刻";
  if (Number.isNaN(new Date(draft.arrivedAt).getTime())) return "到站时刻格式不正确";
  const s = toMinutes(draft.windowStart);
  const e = toMinutes(draft.windowEnd);
  if (s === null) return "承诺窗口开始时间格式应为 HH:mm";
  if (e === null) return "承诺窗口结束时间格式应为 HH:mm";
  if (s >= e) return `承诺送达窗口倒序：开始 ${draft.windowStart} 不早于结束 ${draft.windowEnd}`;
  return null;
}

/**
 * 发车拦截判定：波次容量、冷链滞留上限、送达窗口倒序。
 * 任一规则冲突即整批发车停住（blocked = true），订单保留在待发区。
 */
export function checkWave(input: WaveCheckInput): WaveCheckResult {
  const { station, zone, orders, dispatchedCount, rules, now } = input;
  const key = waveKey(station, zone);
  const conflicts: Conflict[] = [];
  const waveNo = dispatchedCount + 1;

  // 规则一：波次容量
  if (orders.length > rules.waveCapacity) {
    conflicts.push({
      code: "CAPACITY",
      message: `波次容量超限：在站 ${orders.length} 单，上限 ${rules.waveCapacity} 单，超出 ${
        orders.length - rules.waveCapacity
      } 单`,
      orderIds: orders.map((o) => o.id)
    });
  }

  // 规则二：冷链滞留上限（常温不限制）
  if (zone !== "常温") {
    const limit = rules.coldDwellLimit[zone];
    const overdue = orders
      .map((o) => ({ order: o, dwell: Math.round((now - new Date(o.arrivedAt).getTime()) / 60000) }))
      .filter((x) => x.dwell > limit);
    if (overdue.length > 0) {
      conflicts.push({
        code: "COLD_DWELL",
        message: `${zone}滞留超上限 ${limit} 分钟：${overdue
          .map((x) => `${x.order.code} 已滞留 ${x.dwell} 分钟`)
          .join("；")}`,
        orderIds: overdue.map((x) => x.order.id)
      });
    }
  }

  // 规则三：送达窗口倒序
  // 先到站的订单窗口结束更晚、后到站的反而更急：按窗口倒序装车会压住先到的急单。
  const sorted = [...orders].sort(compareRank);
  const pairs: Array<[Order, Order]> = [];
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const urgent = sorted[i]; // 窗口更早、应先送
      const later = sorted[j];
      if (
        urgent.arrivedAt > later.arrivedAt &&
        toMinutes(urgent.windowEnd) !== toMinutes(later.windowEnd)
      ) {
        pairs.push([urgent, later]);
      }
    }
  }
  const involved = new Set<string>();
  for (const [a, b] of pairs) {
    involved.add(a.id);
    involved.add(b.id);
  }
  if (pairs.length > 0) {
    conflicts.push({
      code: "WINDOW_ORDER",
      message: `送达窗口倒序：${pairs
        .map(([urgent, later]) => `${later.code}（先到站，窗口至 ${later.windowEnd}）压住 ${urgent.code}（后到站，窗口至 ${urgent.windowEnd}）`)
        .join("；")}`,
      orderIds: [...involved]
    });
  }

  return { waveKey: key, waveNo, blocked: conflicts.length > 0, conflicts };
}

/** 发车：冻结装车清单，生成首发版本 */
export function createManifest(
  input: WaveCheckInput,
  check: WaveCheckResult,
  nowIso: string
): Manifest {
  return {
    id: uid("mf"),
    waveKey: check.waveKey,
    station: input.station,
    zone: input.zone,
    waveNo: check.waveNo,
    dispatchedAt: nowIso,
    versions: [
      {
        version: 1,
        kind: "首发",
        reason: "首批发车",
        createdAt: nowIso,
        items: buildLoadingItems(input.orders)
      }
    ]
  };
}

/**
 * 补签：清单已冻结不可改，按当前装车序另存一个"补签"原因版本；
 * 旧版本原样保留，可随时切回核对。
 */
export function resignManifest(manifest: Manifest, reason: string, nowIso: string): ManifestVersion {
  return {
    version: manifest.versions.length + 1,
    kind: "补签",
    reason: reason.trim() || "现场补签",
    createdAt: nowIso,
    items: manifest.versions[manifest.versions.length - 1].items
  };
}
