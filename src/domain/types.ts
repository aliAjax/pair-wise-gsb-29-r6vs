/**
 * 数据层类型定义：驿站波次装车台
 * 只描述数据结构，不包含判定逻辑（rules.ts）与界面（App.vue）。
 */

/** 温区 */
export type TempZone = "常温" | "冷藏" | "冷冻";

/** 波次状态 */
export type WaveStatus = "待发" | "已发车";

/** 订单（录入即持久化，冲突只拦发车、不拦登记） */
export interface Order {
  id: string;
  code: string;
  station: string;
  zone: TempZone;
  /** 到站时刻 ISO 字符串 */
  arrivedAt: string;
  /** 承诺送达窗口 "HH:MM" */
  windowStart: string;
  windowEnd: string;
  address: string;
  note: string;
  createdAt: string;
}

/** 波次：按站点 + 温区分波 */
export interface Wave {
  id: string;
  name: string;
  station: string;
  zone: TempZone;
  capacity: number;
  /** 冷链滞留上限（分钟），常温波次忽略 */
  dwellLimitMin: number;
  /** 计划发车时刻 ISO 字符串 */
  plannedDepartAt: string;
  status: WaveStatus;
  orderIds: string[];
  createdAt: string;
}

/** 装车清单条目（发车时快照） */
export interface ManifestEntry {
  orderId: string;
  code: string;
  station: string;
  zone: TempZone;
  arrivedAt: string;
  windowStart: string;
  windowEnd: string;
  address: string;
  note: string;
  /** 补签标记：发车时为 false，补签版本中置 true */
  signed: boolean;
}

/** 清单版本：v1 为发车原始清单，补签产生 v2、v3…，旧版本全部保留 */
export interface ManifestVersion {
  version: number;
  kind: "发车" | "补签";
  reason: string;
  createdAt: string;
  entries: ManifestEntry[];
}

/** 发车后冻结的装车清单 */
export interface Manifest {
  waveId: string;
  departedAt: string;
  versions: ManifestVersion[];
}

/** 冲突类型 */
export type ConflictType = "容量超限" | "冷链滞留超限" | "送达窗口倒序";

/** 冲突：指向具体站点、波次与订单 */
export interface Conflict {
  type: ConflictType;
  waveId: string;
  waveName: string;
  station: string;
  orderIds: string[];
  detail: string;
}

/** 持久化快照（重开页面据此恢复，沿波次核对） */
export interface DockSnapshot {
  orders: Order[];
  waves: Wave[];
  manifests: Manifest[];
}

export const TEMP_ZONES: readonly TempZone[] = ["常温", "冷藏", "冷冻"];

export const STATIONS: readonly string[] = ["世纪大道站", "陆家嘴站", "张江站"];

export const STORAGE_KEY = "hxwlfront-15-wave-dock";
