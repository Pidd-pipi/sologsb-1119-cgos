/** 连续环境窗口：固化期间多次读数，按有效区间并集累计达标时长 */

/** 一次温湿度读数 */
export interface EnvReading {
  id: string;
  /** 读数时刻（ms 时间戳） */
  at: number;
  tempC: number;
  rh: number;
  /** 是否在锁定范围内（落库时判定，便于超标留痕） */
  inRange: boolean;
  note?: string;
}

/** 暂停 / 异常时段（停机为人工登记，超标时段由读数自动派生） */
export interface EnvPause {
  id: string;
  from: number;
  to?: number;
  reason: string;
  /** manual=人工停机；auto=温湿度超标自动派生 */
  kind: 'manual' | 'auto';
}

export type EnvWindowStatus = 'active' | 'finished' | 'released';

/**
 * 环境窗口：开始即锁定胶种批次与合格范围，有效累计时长达标后方可结束。
 * 数据全部落 IndexedDB，关页重开继续累计。
 */
export interface EnvWindow {
  id: string;
  procedureId: string;
  specimenId: string;
  /** 锁定胶种名称 */
  adhesive: string;
  /** 锁定胶种批次（supplies 表 id） */
  adhesiveLotId: string;
  adhesiveLotNo: string;
  /** 锁定合格范围 */
  tempMinC: number;
  tempMaxC: number;
  rhMin: number;
  rhMax: number;
  /** 要求有效累计时长（分钟） */
  requiredMin: number;
  startedAt: number;
  status: EnvWindowStatus;
  finishedAt?: number;
  releasedAt?: number;
  /** 结束时固化的有效累计时长（ms），未结束由读数实时计算 */
  validMs?: number;
  readings: EnvReading[];
  pauses: EnvPause[];
  /** 最近一次「页面开着监测」的心跳时刻，用于实时尾部计时，关页即冻结 */
  observedUntil: number;
}

export type EnvWindowDraft = Omit<EnvWindow, 'id' | 'status' | 'readings' | 'pauses' | 'observedUntil'>;

/** 暂停 / 超标区间（展示用） */
export interface EnvSegment {
  from: number;
  to: number;
  reason: string;
  kind: 'manual' | 'auto';
}

/** 窗口统计结果 */
export interface EnvStats {
  /** 有效累计时长 ms（区间并集，多窗口/并发保存均不重复计时） */
  validMs: number;
  validMin: number;
  requiredMs: number;
  met: boolean;
  /** 已暂停 / 超标总时长 ms */
  pausedMs: number;
  segments: EnvSegment[];
  manualPausedMs: number;
  /** 是否存在尚未恢复的开放区间 */
  openPause: boolean;
  lastReading?: EnvReading;
}

/** 读数是否落在锁定范围内 */
export function isReadingInRange(r: Pick<EnvReading, 'tempC' | 'rh'>, w: Pick<EnvWindow, 'tempMinC' | 'tempMaxC' | 'rhMin' | 'rhMax'>): boolean {
  return r.tempC >= w.tempMinC && r.tempC <= w.tempMaxC && r.rh >= w.rhMin && r.rh <= w.rhMax;
}

type Interval = [number, number];

/** 区间并集：合并重叠/相接区间，天然防止同一时段被算两次 */
export function unionIntervals(input: Interval[]): Interval[] {
  const sorted = input
    .filter(([a, b]) => b > a)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: Interval[] = [];
  for (const iv of sorted) {
    const last = merged[merged.length - 1];
    if (last && iv[0] <= last[1]) {
      last[1] = Math.max(last[1], iv[1]);
    } else {
      merged.push([iv[0], iv[1]]);
    }
  }
  return merged;
}

function unionLength(intervals: Interval[]): number {
  return unionIntervals(intervals).reduce((sum, [a, b]) => sum + (b - a), 0);
}

/** 从 [start,end] 中扣除若干暂停区间，返回剩余区间并集 */
function subtractPauses(start: number, end: number, pauses: Interval[]): Interval[] {
  let pieces: Interval[] = [[start, end]];
  for (const [pf, ptRaw] of unionIntervals(pauses)) {
    const pt = ptRaw;
    const next: Interval[] = [];
    for (const [a, b] of pieces) {
      if (pt <= a || pf >= b) {
        next.push([a, b]);
      } else {
        if (pf > a) next.push([a, Math.max(a, pf)]);
        if (pt < b) next.push([Math.min(b, pt), b]);
      }
    }
    pieces = next;
  }
  return unionIntervals(pieces);
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * 计算窗口有效累计时长与暂停记录。
 *
 * 读数是状态采样：以「开始时刻 + 去重排序后的读数」为锚点切分时间轴，
 * 某条读数合格，则从该时刻到下一条读数/尾锚点持续计入；读数超标则该段不计，
 * 直到下一条合格读数恢复续算。人工停机时段从有效区间中扣除（区间并集，同一时段不重复）。
 * 监测中且页面正在观测（心跳 15s 内）时，尾部从最后读数延伸到当前时刻；
 * 关页后尾部停在最后读数，已累计时段保留。
 */
export function envStats(w: EnvWindow, now: number = Date.now()): EnvStats {
  // 同一时刻多次保存（并发双页）视为同一次读数：按时间戳合并，
  // 任一条在范围内即按合格计（避免重复保存产生重复计时，也不被重复中的异常值误伤）
  const mergedAt = new Map<number, EnvReading>();
  for (const r of w.readings) {
    const prev = mergedAt.get(r.at);
    if (!prev) {
      mergedAt.set(r.at, r);
    } else {
      const good = r.inRange ? r : prev;
      mergedAt.set(r.at, {
        ...good,
        // 合并保留可能的备注与 id
        id: prev.id,
        inRange: prev.inRange || r.inRange,
        note: prev.note ?? r.note,
      });
    }
  }
  const readings = [...mergedAt.values()].sort((a, b) => a.at - b.at);

  // 尾锚点：已结束/已释放窗口取结束时刻；监测中取「最后读数」，
  // 若页面正开着（心跳新鲜，15s 内）则延伸到当前时刻，实现实时累计
  const heartbeatFresh = w.status === 'active' && now - w.observedUntil <= 15000;
  const lastAt = readings.length > 0 ? readings[readings.length - 1].at : w.startedAt;
  let tail: number;
  if (w.status !== 'active') {
    tail = w.finishedAt ?? w.releasedAt ?? w.observedUntil;
  } else if (heartbeatFresh) {
    tail = Math.max(lastAt, now);
  } else {
    tail = Math.max(w.observedUntil, lastAt);
  }
  tail = Math.max(tail, w.startedAt);

  const anchors = [w.startedAt, ...readings.map((r) => r.at)];
  if (tail > anchors[anchors.length - 1]) anchors.push(tail);

  // 读数是状态采样：某锚点读数合格，则环境从该时刻起持续合格，直到下一次读数/尾锚点；
  // 读数超标，则从该时刻起无效，直到下一条合格读数（恢复后续算）。
  const validRaw: Interval[] = [];
  const autoPauses: Interval[] = [];
  for (let i = 0; i < anchors.length - 1; i += 1) {
    const t0 = anchors[i];
    const t1 = anchors[i + 1];
    if (t1 <= t0) continue;
    const r0 = readings.find((r) => r.at === t0);
    // 首条读数之前的头部区间无法证实，不计入
    if (!r0) {
      autoPauses.push([t0, t1]);
      continue;
    }
    if (r0.inRange) validRaw.push([t0, t1]);
    else autoPauses.push([t0, t1]);
  }

  // 人工停机：开放区间在尾锚点收口（历史窗口/关页后不会把停机算到真实 now）
  const manualPauses: Interval[] = w.pauses
    .map((p): Interval => [p.from, Math.min(Math.max(p.from, p.to ?? tail), tail)])
    .filter(([a, b]) => b > a && b > w.startedAt && a < tail);

  // 有效区间扣除人工停机；自动超标区间只用于展示，不再二次扣减
  const validIntervals = subtractPauses(w.startedAt, tail, manualPauses)
    .flatMap(([a, b]) => validRaw.filter(([v0, v1]) => v1 > a && v0 < b).map(([v0, v1]) => [Math.max(a, v0), Math.min(b, v1)] as Interval));
  const computedValidMs = unionLength(validIntervals);
  const validMs = w.status === 'finished' && typeof w.validMs === 'number' ? w.validMs : computedValidMs;

  // 展示用：人工停机 + 自动超标合并，并集去重重叠
  const segments: EnvSegment[] = [
    ...manualPauses.map((iv) => {
      const src = w.pauses.find((p) => p.from === iv[0]);
      return { from: iv[0], to: iv[1], reason: src?.reason ?? '设备停机', kind: 'manual' as const };
    }),
    ...unionIntervals(autoPauses).map(([from, to]) => ({ from, to, reason: '温湿度超标', kind: 'auto' as const })),
  ]
    .map((s) => ({ ...s, to: Math.min(s.to, tail), from: Math.max(s.from, w.startedAt) }))
    .filter((s) => s.to > s.from);

  const pausedMs = unionLength(segments.map((s): Interval => [s.from, s.to]));
  const manualPausedMs = unionLength(manualPauses);
  const requiredMs = w.requiredMin * 60000;
  const openPause =
    w.status === 'active' &&
    (w.pauses.some((p) => p.to === undefined) || (readings.length > 0 && !readings[readings.length - 1].inRange));

  return {
    validMs,
    validMin: Math.floor(validMs / 60000),
    requiredMs,
    met: validMs >= requiredMs,
    pausedMs,
    manualPausedMs,
    segments: segments.sort((a, b) => a.from - b.from),
    openPause,
    lastReading: readings[readings.length - 1],
  };
}

/** 0–1 的达标进度 */
export function envProgress(w: EnvWindow, now: number = Date.now()): number {
  const s = envStats(w, now);
  return clamp01(s.validMs / s.requiredMs);
}

/** 格式化分钟时长 */
export function formatMin(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** 工序是否需要环境窗口验收（使用胶种的工序） */
export function procedureNeedsEnv(p: { adhesive?: string }): boolean {
  return !!p.adhesive && p.adhesive.trim().length > 0;
}
