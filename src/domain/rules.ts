/**
 * 判定层：纯函数，不读写存储、不依赖界面。
 * 输入订单与波次，输出发车前冲突清单。
 */
import type { Conflict, Order, Wave } from "./types";

function minutesOf(iso: string): number {
  const time = new Date(iso).getTime();
  return Number.isNaN(time) ? 0 : time / 60000;
}

/** 承诺窗口结束时刻换算为分钟（用于倒序检查与排序） */
function windowEndMinutes(order: Order): number {
  const [h, m] = order.windowEnd.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * 校验单个波次能否发车。
 * 规则：
 * 1. 容量超限：装车订单数 > 波次容量；
 * 2. 冷链滞留超限：冷藏/冷冻波次中，订单在计划发车时刻的滞留时长超过上限；
 * 3. 送达窗口倒序：按窗口结束升序排序为正确装车序，若相邻订单出现先装后到的倒序即冲突。
 */
export function checkWave(wave: Wave, orders: Order[]): Conflict[] {
  const conflicts: Conflict[] = [];
  const loaded = wave.orderIds
    .map((id) => orders.find((order) => order.id === id))
    .filter((order): order is Order => Boolean(order));

  if (loaded.length > wave.capacity) {
    const overflow = loaded.slice(wave.capacity);
    conflicts.push({
      type: "容量超限",
      waveId: wave.id,
      waveName: wave.name,
      station: wave.station,
      orderIds: overflow.map((order) => order.id),
      detail: `已装 ${loaded.length} 单，超过波次容量 ${wave.capacity} 单，超出：${overflow
        .map((order) => order.code)
        .join("、")}`,
    });
  }

  if (wave.zone !== "常温" && wave.dwellLimitMin > 0) {
    const depart = minutesOf(wave.plannedDepartAt);
    const overstayed = loaded.filter(
      (order) => depart - minutesOf(order.arrivedAt) > wave.dwellLimitMin
    );
    if (overstayed.length > 0) {
      conflicts.push({
        type: "冷链滞留超限",
        waveId: wave.id,
        waveName: wave.name,
        station: wave.station,
        orderIds: overstayed.map((order) => order.id),
        detail: overstayed
          .map(
            (order) =>
              `${order.code} 滞留 ${Math.round(depart - minutesOf(order.arrivedAt))} 分钟，超过上限 ${wave.dwellLimitMin} 分钟`
          )
          .join("；"),
      });
    }
  }

  // 装车顺序以波次内登记顺序为准，应满足窗口结束升序；相邻出现倒序即冲突
  for (let i = 1; i < loaded.length; i += 1) {
    const prev = loaded[i - 1];
    const curr = loaded[i];
    if (windowEndMinutes(curr) < windowEndMinutes(prev)) {
      conflicts.push({
        type: "送达窗口倒序",
        waveId: wave.id,
        waveName: wave.name,
        station: wave.station,
        orderIds: [prev.id, curr.id],
        detail: `${prev.code}（${prev.windowStart}-${prev.windowEnd}）排在 ${curr.code}（${curr.windowStart}-${curr.windowEnd}）之前，窗口倒序`,
      });
    }
  }

  return conflicts;
}

/** 汇总全部待发波次的冲突；任一冲突存在即整批发车停住 */
export function checkAllWaves(waves: Wave[], orders: Order[]): Conflict[] {
  return waves
    .filter((wave) => wave.status === "待发")
    .flatMap((wave) => checkWave(wave, orders));
}

/** 按承诺窗口结束升序生成装车清单顺序 */
export function sortForManifest(wave: Wave, orders: Order[]): Order[] {
  return wave.orderIds
    .map((id) => orders.find((order) => order.id === id))
    .filter((order): order is Order => Boolean(order))
    .sort((a, b) => windowEndMinutes(a) - windowEndMinutes(b));
}
