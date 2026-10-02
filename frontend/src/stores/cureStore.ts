import { create } from 'zustand';
import { db } from '../utils/db';
import { newId } from '../utils/id';
import {
  recomputeWindow,
  effectiveMinOf,
  readingInRange,
  type CureWindow,
  type CureRange,
  type CurePause,
  type CureReading,
} from '../types/cure';
import { useSupplyStore } from './supplyStore';

export interface StartWindowInput {
  procedureId: string;
  specimenId: string;
  specimenNo: string;
  supplyLotId: string;
  adhesive: string;
  range: CureRange;
  requiredMin: number;
  usedQty: number;
  operator: string;
}

export interface ManualConfirmInput {
  procedureId: string;
  specimenId: string;
  supplyLotId: string;
  adhesive: string;
  range: CureRange;
  manualMin: number;
  operator: string;
}

interface CureState {
  items: CureWindow[];
  loaded: boolean;
  load: () => Promise<void>;
  /** 开始养护窗口：锁定胶种批次（领用扣减），进入运行态 */
  startWindow: (input: StartWindowInput) => Promise<CureWindow>;
  /** 记录一次读数：超标自动暂停，恢复达标自动续计 */
  takeReading: (windowId: string, tempC: number, rh: number) => Promise<void>;
  /** 手动停机（暂停） */
  reportStop: (windowId: string, reason: CurePause['reason']) => Promise<void>;
  /** 手动恢复（续计） */
  reportResume: (windowId: string) => Promise<void>;
  /** 结束窗口：有效累计时长达到要求才允许 */
  closeWindow: (windowId: string) => Promise<{ ok: boolean; error?: string }>;
  /** 回退工序：释放未关闭窗口与锁定批次 */
  releaseByProcedure: (procedureId: string) => Promise<void>;
  /** 旧数据人工确认：生成一条已关闭的人工确认窗口 */
  manualConfirm: (input: ManualConfirmInput) => Promise<CureWindow>;
  removeByProcedure: (procedureId: string) => Promise<void>;
}

export const useCureStore = create<CureState>((set, get) => ({
  items: [],
  loaded: false,
  async load() {
    const rows = await db.cureWindows.toArray();
    const now = Date.now();
    const items = rows
      .map((w) => recomputeWindow(w, now))
      .sort((a, b) => a.startedAt - b.startedAt);
    set({ items, loaded: true });
  },

  async startWindow(input) {
    const now = Date.now();
    const win: CureWindow = {
      id: newId('cur'),
      procedureId: input.procedureId,
      specimenId: input.specimenId,
      supplyLotId: input.supplyLotId,
      adhesive: input.adhesive,
      range: input.range,
      requiredMin: input.requiredMin,
      startedAt: now,
      status: 'running',
      readings: [],
      pauses: [],
      effectiveMin: 0,
      usedQty: input.usedQty,
      createdAt: now,
      updatedAt: now,
    };
    // 锁定胶种批次：领用扣减并关联到本窗口（回退时释放）
    if (input.supplyLotId) {
      await useSupplyStore.getState().issue(input.supplyLotId, {
        qty: input.usedQty,
        operator: input.operator,
        specimenNo: input.specimenNo,
        procedureId: input.procedureId,
        cureWindowId: win.id,
      });
    }
    await db.cureWindows.put(win);
    set({ items: [...get().items, win] });
    return win;
  },

  async takeReading(windowId, tempC, rh) {
    const now = Date.now();
    const cur = get().items.find((w) => w.id === windowId);
    if (!cur) return;
    const valid = readingInRange(cur.range, tempC, rh);
    const reading: CureReading = { at: now, tempC, rh, valid };

    let pauses = cur.pauses;
    let status = cur.status;
    if (cur.status === 'running' && !valid) {
      // 超标：自动暂停（停机/超标时段不计入有效时长）
      pauses = [...pauses, { id: newId('pau'), pausedAt: now, reason: '超标' }];
      status = 'paused';
    } else if (cur.status === 'paused' && valid) {
      // 恢复达标：自动续计
      pauses = pauses.map((p) => (p.resumedAt == null ? { ...p, resumedAt: now } : p));
      status = 'running';
    }
    const next = recomputeWindow({ ...cur, readings: [...cur.readings, reading], pauses, status }, now);
    await db.cureWindows.put(next);
    set({ items: get().items.map((w) => (w.id === windowId ? next : w)) });
  },

  async reportStop(windowId, reason) {
    const now = Date.now();
    const cur = get().items.find((w) => w.id === windowId);
    if (!cur || cur.status !== 'running') return;
    const next = recomputeWindow(
      { ...cur, status: 'paused', pauses: [...cur.pauses, { id: newId('pau'), pausedAt: now, reason }] },
      now,
    );
    await db.cureWindows.put(next);
    set({ items: get().items.map((w) => (w.id === windowId ? next : w)) });
  },

  async reportResume(windowId) {
    const now = Date.now();
    const cur = get().items.find((w) => w.id === windowId);
    if (!cur || cur.status !== 'paused') return;
    const pauses = cur.pauses.map((p) => (p.resumedAt == null ? { ...p, resumedAt: now } : p));
    const next = recomputeWindow({ ...cur, status: 'running', pauses }, now);
    await db.cureWindows.put(next);
    set({ items: get().items.map((w) => (w.id === windowId ? next : w)) });
  },

  async closeWindow(windowId) {
    const now = Date.now();
    const cur = get().items.find((w) => w.id === windowId);
    if (!cur) return { ok: false, error: '窗口不存在' };
    const siblings = get().items.filter((w) => w.procedureId === cur.procedureId);
    const total = effectiveMinOf(siblings, now);
    if (total < cur.requiredMin) {
      return {
        ok: false,
        error: `有效累计时长 ${Math.round(total)} min 未达要求 ${cur.requiredMin} min，暂不能结束`,
      };
    }
    const next = recomputeWindow({ ...cur, status: 'closed', endedAt: now }, now);
    await db.cureWindows.put(next);
    set({ items: get().items.map((w) => (w.id === windowId ? next : w)) });
    return { ok: true };
  },

  async releaseByProcedure(procedureId) {
    const now = Date.now();
    const all = get().items.filter((w) => w.procedureId === procedureId);
    for (const w of all) {
      // 释放该窗口锁定的胶种批次（回补领用数量）；无领用记录时为 no-op
      await useSupplyStore.getState().releaseIssueByWindow(w.id);
      const next = recomputeWindow({ ...w, status: 'closed', endedAt: w.endedAt ?? now }, now);
      await db.cureWindows.put(next);
    }
    const ids = new Set(all.map((w) => w.id));
    set({
      items: get().items.map((w) =>
        ids.has(w.id) ? { ...w, status: 'closed', endedAt: w.endedAt ?? now } : w,
      ),
    });
  },

  async manualConfirm(input) {
    const now = Date.now();
    const win: CureWindow = {
      id: newId('cur'),
      procedureId: input.procedureId,
      specimenId: input.specimenId,
      supplyLotId: input.supplyLotId,
      adhesive: input.adhesive,
      range: input.range,
      requiredMin: input.manualMin,
      startedAt: now,
      endedAt: now,
      status: 'closed',
      readings: [],
      pauses: [],
      effectiveMin: input.manualMin,
      manualConfirmed: true,
      manualMin: input.manualMin,
      createdAt: now,
      updatedAt: now,
    };
    await db.cureWindows.put(win);
    set({ items: [...get().items, win] });
    return win;
  },

  async removeByProcedure(procedureId) {
    const rows = get().items.filter((w) => w.procedureId === procedureId);
    await db.cureWindows.bulkDelete(rows.map((w) => w.id));
    set({ items: get().items.filter((w) => w.procedureId !== procedureId) });
  },
}));
