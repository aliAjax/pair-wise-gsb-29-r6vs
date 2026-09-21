// 领域模型：数据层与判定层共用，界面层只读取，不在这里写任何逻辑。

export type TempZone = "常温" | "冷藏" | "冷冻";

export const TEMP_ZONES: readonly TempZone[] = ["常温", "冷藏", "冷冻"];

/** 温区展示顺序，用于波次排序 */
export const ZONE_ORDER: Record<TempZone, number> = {
  常温: 0,
  冷藏: 1,
  冷冻: 2
};

/** 登记时提交的原始内容（到站时刻为 datetime-local 字符串） */
export interface OrderDraft {
  code: string;
  station: string;
  zone: TempZone;
  arrivedAt: string;
  windowStart: string; // HH:mm
  windowEnd: string; // HH:mm
  consignee: string;
}

/** 待发波次中的订单（到站时刻统一存 ISO，保证重开页面后滞留判定一致） */
export interface Order extends OrderDraft {
  id: string;
  arrivedAt: string; // ISO
  createdAt: string; // ISO
}

/** 发车瞬间冻结进清单的订单快照，装车序已固定 */
export interface LoadingItem {
  orderId: string;
  code: string;
  station: string;
  zone: TempZone;
  arrivedAt: string;
  windowStart: string;
  windowEnd: string;
  consignee: string;
  /** 装车顺序：1 最先装车（车厢最里层），序号越大越靠车门、越先送达 */
  loadingSeq: number;
}

/** 清单版本：首发为 v1，每次补签追加一版，旧版本完整保留 */
export interface ManifestVersion {
  version: number;
  kind: "首发" | "补签";
  reason: string;
  createdAt: string; // ISO
  items: LoadingItem[];
}

/** 已发车波次的冻结装车清单 */
export interface Manifest {
  id: string;
  waveKey: string;
  station: string;
  zone: TempZone;
  /** 同一 站点+温区 内的波次序号 */
  waveNo: number;
  dispatchedAt: string; // ISO
  versions: ManifestVersion[];
}
