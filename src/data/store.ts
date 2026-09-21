/**
 * 数据层：负责持久化与状态变更，不内嵌冲突判定（rules.ts）与界面（App.vue）。
 * 所有变更写回 localStorage，重开页面后沿波次恢复核对。
 */
import type { DockSnapshot, Manifest, ManifestEntry, Order, Wave } from "../domain/types";
import { sortForManifest } from "../domain/rules";
import { STORAGE_KEY } from "../domain/types";

function seedSnapshot(): DockSnapshot {
  const now = Date.now();
  const iso = (offsetMin: number) => new Date(now + offsetMin * 60000).toISOString();

  const orders: Order[] = [
    {
      id: "seed-o1",
      code: "D-1001",
      station: "世纪大道站",
      zone: "常温",
      arrivedAt: iso(-180),
      windowStart: "10:00",
      windowEnd: "12:00",
      address: "世纪大道 100 号",
      note: "前台代收",
      createdAt: iso(-180),
    },
    {
      id: "seed-o2",
      code: "D-1002",
      station: "世纪大道站",
      zone: "常温",
      arrivedAt: iso(-150),
      windowStart: "14:00",
      windowEnd: "16:00",
      address: "世纪大道 210 号",
      note: "",
      createdAt: iso(-150),
    },
    {
      id: "seed-o3",
      code: "C-2001",
      station: "世纪大道站",
      zone: "冷藏",
      arrivedAt: iso(-40),
      windowStart: "11:00",
      windowEnd: "13:00",
      address: "张杨路 500 号",
      note: "生鲜优先",
      createdAt: iso(-40),
    },
    {
      id: "seed-o4",
      code: "C-2002",
      station: "世纪大道站",
      zone: "冷藏",
      arrivedAt: iso(-30),
      windowStart: "09:00",
      windowEnd: "11:00",
      address: "张杨路 620 号",
      note: "",
      createdAt: iso(-30),
    },
    {
      id: "seed-o5",
      code: "D-3001",
      station: "陆家嘴站",
      zone: "常温",
      arrivedAt: iso(-90),
      windowStart: "15:00",
      windowEnd: "17:00",
      address: "陆家嘴环路 1088 号",
      note: "",
      createdAt: iso(-90),
    },
  ];

  const waves: Wave[] = [
    {
      id: "seed-w1",
      name: "世纪大道站·常温·W1",
      station: "世纪大道站",
      zone: "常温",
      capacity: 6,
      dwellLimitMin: 0,
      plannedDepartAt: iso(60),
      status: "待发",
      orderIds: ["seed-o1", "seed-o2"],
      createdAt: iso(-170),
    },
    {
      id: "seed-w2",
      name: "世纪大道站·冷藏·W1",
      station: "世纪大道站",
      zone: "冷藏",
      capacity: 4,
      dwellLimitMin: 90,
      plannedDepartAt: iso(30),
      status: "待发",
      orderIds: ["seed-o3", "seed-o4"],
      createdAt: iso(-35),
    },
    {
      id: "seed-w3",
      name: "陆家嘴站·常温·W1",
      station: "陆家嘴站",
      zone: "常温",
      capacity: 5,
      dwellLimitMin: 0,
      plannedDepartAt: iso(120),
      status: "待发",
      orderIds: ["seed-o5"],
      createdAt: iso(-80),
    },
  ];

  return { orders, waves, manifests: [] };
}

export function loadSnapshot(): DockSnapshot {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return seedSnapshot();
  try {
    const parsed = JSON.parse(raw) as DockSnapshot;
    return {
      orders: parsed.orders ?? [],
      waves: parsed.waves ?? [],
      manifests: parsed.manifests ?? [],
    };
  } catch {
    return seedSnapshot();
  }
}

export function saveSnapshot(snapshot: DockSnapshot): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
}

/** 清空持久化并回到演示数据 */
export function resetSnapshot(): DockSnapshot {
  localStorage.removeItem(STORAGE_KEY);
  return seedSnapshot();
}

export function createId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 发车：冻结当前装车清单为 v1，波次转为已发车 */
export function departWave(snapshot: DockSnapshot, waveId: string, departedAt: string): DockSnapshot {
  const wave = snapshot.waves.find((item) => item.id === waveId);
  if (!wave || wave.status !== "待发") return snapshot;

  const entries: ManifestEntry[] = sortForManifest(wave, snapshot.orders).map((order) => ({
    orderId: order.id,
    code: order.code,
    station: order.station,
    zone: order.zone,
    arrivedAt: order.arrivedAt,
    windowStart: order.windowStart,
    windowEnd: order.windowEnd,
    address: order.address,
    note: order.note,
    signed: false,
  }));

  const manifest: Manifest = {
    waveId,
    departedAt,
    versions: [{ version: 1, kind: "发车", reason: "发车原始清单", createdAt: departedAt, entries }],
  };

  return {
    orders: snapshot.orders,
    waves: snapshot.waves.map((item) =>
      item.id === waveId ? { ...item, status: "已发车" } : item
    ),
    manifests: [...snapshot.manifests.filter((item) => item.waveId !== waveId), manifest],
  };
}

/** 补签：在冻结清单上追加一个带原因的新版本，旧版本原样保留 */
export function supplementManifest(
  snapshot: DockSnapshot,
  waveId: string,
  reason: string,
  entries: ManifestEntry[],
  createdAt: string
): DockSnapshot {
  const manifest = snapshot.manifests.find((item) => item.waveId === waveId);
  if (!manifest) return snapshot;

  const version: Manifest["versions"][number] = {
    version: manifest.versions.length + 1,
    kind: "补签",
    reason,
    createdAt,
    entries,
  };

  return {
    ...snapshot,
    manifests: snapshot.manifests.map((item) =>
      item.waveId === waveId
        ? { ...item, versions: [...item.versions, version] }
        : item
    ),
  };
}
