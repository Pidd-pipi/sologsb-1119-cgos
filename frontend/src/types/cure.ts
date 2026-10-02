/**
 * 养护（固化）连续环境窗口：读数、暂停记录与纯计算。
 *
 * 验收口径：工序开始时锁定胶种批次与温湿度范围，之后多次读数；
 * 只有处于「运行」状态的时段才计入有效累计时长，停机/超标时段暂停不计，
 * 恢复后接着累计；多个窗口重叠的时段只算一次。
 */

/** 一次温湿度读数 */
export interface CureReading {
  /** 采样时间 */
  at: number;
  tempC: number;
  rh: number;
  /** 该读数是否在锁定范围内（有效） */
  valid: boolean;
  note?: string;
}

/** 暂停（异常）记录 */
export interface CurePause {
  id: string;
  /** 异常开始（停机/超标） */
  pausedAt: number;
  reason: '停机' | '超标' | '其他';
  /** 恢复时间；窗口仍处于暂停态时为空 */
  resumedAt?: number;
}

/** 锁定的验收范围 */
export interface CureRange {
  tempMin: number;
  tempMax: number;
  rhMin: number;
  rhMax: number;
}

export type CureWindowStatus = 'running' | 'paused' | 'closed';

/** 连续环境窗口 */
export interface CureWindow {
  id: string;
  procedureId: string;
  specimenId: string;
  /** 锁定的胶种批次 SupplyLot.id */
  supplyLotId: string;
  /** 胶种名称快照 */
  adhesive: string;
  /** 锁定的验收范围 */
  range: CureRange;
  /** 要求的有效累计时长（min） */
  requiredMin: number;
  startedAt: number;
  endedAt?: number;
  status: CureWindowStatus;
  readings: CureReading[];
  pauses: CurePause[];
  /** 本窗口有效累计时长（min，未跨窗口去重） */
  effectiveMin: number;
  /** 人工确认标记：旧数据升级无读数时，由人工确认后 closed */
  manualConfirmed?: boolean;
  /** 人工确认填报的时长（min） */
  manualMin?: number;
  /** 锁定批次时领用的数量 */
  usedQty?: number;
  createdAt: number;
  updatedAt: number;
}

export type CureWindowDraft = Omit<
  CureWindow,
  'id' | 'readings' | 'pauses' | 'effectiveMin' | 'createdAt' | 'updatedAt'
>;

/** 读数是否落在锁定范围内 */
export function readingInRange(range: CureRange, tempC: number, rh: number): boolean {
  return tempC >= range.tempMin && tempC <= range.tempMax && rh >= range.rhMin && rh <= range.rhMax;
}

/**
 * 单个窗口的运行（有效）区间（绝对时间戳），由暂停记录切分。
 * 运行态计入，暂停态不计；尾部取到 endedAt（已关闭）或当前时刻（仍在累计）。
 */
export function windowRunningIntervals(w: CureWindow, now: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const events: Array<{ at: number; type: 'pause' | 'resume' }> = [];
  for (const p of w.pauses) {
    events.push({ at: p.pausedAt, type: 'pause' });
    if (p.resumedAt != null) events.push({ at: p.resumedAt, type: 'resume' });
  }
  events.sort((a, b) => a.at - b.at);

  let state: 'running' | 'paused' = 'running';
  let segStart = w.startedAt;
  for (const ev of events) {
    if (ev.type === 'pause') {
      if (state === 'running') {
        if (ev.at > segStart) out.push([segStart, ev.at]);
        state = 'paused';
      }
    } else if (state === 'paused') {
      segStart = ev.at;
      state = 'running';
    }
  }
  const end = w.endedAt ?? now;
  if (state === 'running' && end > segStart) out.push([segStart, end]);
  return out;
}

/** 区间取并集（重叠时段只保留一次） */
export function unionIntervals(intervals: Array<[number, number]>): Array<[number, number]> {
  if (intervals.length === 0) return [];
  const sorted = intervals
    .map(([s, e]) => [s, e] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [sorted[0]];
  for (const [s, e] of sorted.slice(1)) {
    const last = merged[merged.length - 1];
    if (s <= last[1]) {
      if (e > last[1]) last[1] = e;
    } else {
      merged.push([s, e]);
    }
  }
  return merged;
}

export function sumIntervalsMs(intervals: Array<[number, number]>): number {
  return intervals.reduce((acc, [s, e]) => acc + Math.max(0, e - s), 0);
}

/**
 * 跨窗口有效累计时长（min）。
 * 人工确认窗口直接计入其填报时长；其余窗口取运行区间并集（重叠不重复算）。
 */
export function effectiveMinOf(windows: CureWindow[], now = Date.now()): number {
  let manual = 0;
  const intervals: Array<[number, number]> = [];
  for (const w of windows) {
    if (w.manualConfirmed) {
      manual += w.manualMin ?? 0;
    } else {
      intervals.push(...windowRunningIntervals(w, now));
    }
  }
  return manual + sumIntervalsMs(unionIntervals(intervals)) / 60000;
}

/** 重算单个窗口的 effectiveMin（不跨窗口去重） */
export function recomputeWindow(w: CureWindow, now = Date.now()): CureWindow {
  const ms = sumIntervalsMs(windowRunningIntervals(w, now));
  return { ...w, effectiveMin: Math.round((ms / 60000) * 10) / 10, updatedAt: now };
}

/** 读数总数 */
export function readingCountOf(windows: CureWindow[]): number {
  return windows.reduce((acc, w) => acc + w.readings.length, 0);
}

/** 暂停记录总数 */
export function pauseCountOf(windows: CureWindow[]): number {
  return windows.reduce((acc, w) => acc + w.pauses.length, 0);
}

/** 时长文案：90 -> "90 min"，1500 -> "25 h 0 min" */
export function fmtMin(min: number): string {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (h === 0) return `${mm} min`;
  return `${h} h ${mm} min`;
}

/** 时间戳文案 */
export function fmtClock(ts?: number): string {
  if (!ts) return '—';
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
