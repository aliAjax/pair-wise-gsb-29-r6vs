// 首次打开时的演示数据：覆盖正常波次与三类拦截场景。
// 数据层只负责存取，种子在这里集中构造，判定仍走 domain 的同一套规则。

import type { Manifest, Order, TempZone } from "../types";
import { buildLoadingItems } from "../domain/rules";

function hhmm(offsetMin: number): string {
  const d = new Date(Date.now() + offsetMin * 60000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function isoAgo(min: number): string {
  return new Date(Date.now() - min * 60000).toISOString();
}

function isoFuture(min: number): string {
  return new Date(Date.now() + min * 60000).toISOString();
}

function order(
  id: string,
  code: string,
  station: string,
  zone: TempZone,
  arrivedAgoMin: number,
  windowStart: string,
  windowEnd: string,
  consignee: string
): Order {
  return {
    id,
    code,
    station,
    zone,
    arrivedAt: isoAgo(arrivedAgoMin),
    windowStart,
    windowEnd,
    consignee,
    createdAt: isoAgo(arrivedAgoMin + 1)
  };
}

export function seedOrders(): Order[] {
  // 幸福里·常温：到站先后与窗口一致，可正常发车（2 单）
  // 幸福里·冷藏：4 单顶格，最早一单滞留 55 分钟 > 40 → 冷链滞留拦截
  // 幸福里·冷冻：后到站的单窗口反而更早 → 送达窗口倒序拦截（2 单）
  // 滨江花园·常温：5 单 > 容量 4 → 容量拦截
  return [
    order("seed-o1", "YD-1001", "幸福里驿站", "常温", 18, hhmm(30), hhmm(120), "张女士"),
    order("seed-o2", "YD-1002", "幸福里驿站", "常温", 10, hhmm(60), hhmm(150), "李先生"),

    order("seed-o3", "YD-2001", "幸福里驿站", "冷藏", 55, hhmm(10), hhmm(90), "生鲜店"),
    order("seed-o4", "YD-2002", "幸福里驿站", "冷藏", 30, hhmm(20), hhmm(100), "王女士"),
    order("seed-o5", "YD-2003", "幸福里驿站", "冷藏", 20, hhmm(40), hhmm(120), "赵先生"),
    order("seed-o6", "YD-2004", "幸福里驿站", "冷藏", 8, hhmm(60), hhmm(150), "钱女士"),

    order("seed-o7", "YD-3001", "幸福里驿站", "冷冻", 25, hhmm(60), hhmm(180), "火锅店"),
    order("seed-o8", "YD-3002", "幸福里驿站", "冷冻", 12, hhmm(10), hhmm(70), "陈女士"),

    order("seed-o9", "YD-4001", "滨江花园站", "常温", 22, hhmm(30), hhmm(120), "孙先生"),
    order("seed-o10", "YD-4002", "滨江花园站", "常温", 19, hhmm(40), hhmm(130), "周女士"),
    order("seed-o11", "YD-4003", "滨江花园站", "常温", 15, hhmm(50), hhmm(140), "吴先生"),
    order("seed-o12", "YD-4004", "滨江花园站", "常温", 11, hhmm(60), hhmm(150), "郑女士"),
    order("seed-o13", "YD-4005", "滨江花园站", "常温", 6, hhmm(80), hhmm(170), "冯先生")
  ];
}

export function seedManifests(): Manifest[] {
  // 滨江花园站·冷藏已发过两波，演示冻结清单的版本链（首发 + 补签）
  const firstAt = isoAgo(60 * 26);
  const ordersV1 = [
    order("seed-mf-o1", "YD-0901", "滨江花园站", "冷藏", 60 * 27, hhmm(-60 * 24), hhmm(-60 * 22), "冷柜A"),
    order("seed-mf-o2", "YD-0902", "滨江花园站", "冷藏", 60 * 26.5, hhmm(-60 * 24), hhmm(-60 * 21), "冷柜B")
  ];
  const v2At = isoFuture(15);
  return [
    {
      id: "seed-mf-1",
      waveKey: "滨江花园站｜冷藏",
      station: "滨江花园站",
      zone: "冷藏",
      waveNo: 1,
      dispatchedAt: firstAt,
      versions: [
        { version: 1, kind: "首发", reason: "首批发车", createdAt: firstAt, items: buildLoadingItems(ordersV1) },
        {
          version: 2,
          kind: "补签",
          reason: "车厢温控记录补传，站长补签确认",
          createdAt: v2At,
          items: buildLoadingItems(ordersV1)
        }
      ]
    }
  ];
}
