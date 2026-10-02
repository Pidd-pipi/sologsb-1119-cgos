import { useMemo } from 'react';
import { useCureStore } from '../stores/cureStore';
import {
  effectiveMinOf,
  readingCountOf,
  pauseCountOf,
  type CureWindow,
  type CurePause,
} from '../types/cure';

export interface ProcedureCure {
  /** 该工序的全部窗口（按开始时间排序） */
  windows: CureWindow[];
  /** 跨窗口有效累计时长（min，重叠不重复算） */
  totalEffectiveMin: number;
  /** 当前未关闭窗口 */
  open: CureWindow | undefined;
  /** 读数总数 */
  readingCount: number;
  /** 暂停记录（跨窗口） */
  pauses: CurePause[];
  /** 暂停次数 */
  pauseCount: number;
  /** 是否存在进行中的窗口 */
  running: boolean;
}

/** 某工序的连续环境窗口汇总：有效累计时长、读数与暂停记录 */
export function useProcedureCure(procedureId: string | undefined): ProcedureCure {
  const items = useCureStore((s) => s.items);

  return useMemo(() => {
    const windows = (procedureId ? items.filter((w) => w.procedureId === procedureId) : []).sort(
      (a, b) => a.startedAt - b.startedAt,
    );
    const now = Date.now();
    const pauses = windows.flatMap((w) => w.pauses);
    return {
      windows,
      totalEffectiveMin: effectiveMinOf(windows, now),
      open: windows.find((w) => w.status !== 'closed'),
      readingCount: readingCountOf(windows),
      pauses,
      pauseCount: pauseCountOf(windows),
      running: windows.some((w) => w.status === 'running'),
    };
  }, [items, procedureId]);
}
