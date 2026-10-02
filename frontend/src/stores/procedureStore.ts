import { create } from 'zustand';
import { db } from '../utils/db';
import { newId } from '../utils/id';
import { useEnvWindowStore } from './envWindowStore';
import type { PrepProcedure, PrepProcedureDraft } from '../types/procedure';
import { envStats, procedureNeedsEnv } from '../types/envWindow';

interface ProcedureState {
  items: PrepProcedure[];
  loaded: boolean;
  load: () => Promise<void>;
  add: (draft: PrepProcedureDraft) => Promise<PrepProcedure>;
  attachEnvWindow: (id: string, windowId: string, lotId: string) => Promise<void>;
  finish: (id: string) => Promise<void>;
  /** 老数据（升级前无读数工序）人工确认 */
  confirmLegacy: (id: string) => Promise<void>;
  rollback: (id: string, reason?: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  bySpecimen: (specimenId: string) => PrepProcedure[];
}

/** 工序是否允许点「完成节点」：用胶工序必须有达标窗口或经人工确认 */
export function canFinishProcedure(p: PrepProcedure): { ok: boolean; reason?: string } {
  if (!procedureNeedsEnv(p)) return { ok: true };
  const win = useEnvWindowStore.getState().byProcedure(p.id);
  if (win) {
    if (win.status !== 'active') return { ok: true };
    const s = envStats(win);
    return s.met
      ? { ok: true }
      : { ok: false, reason: `环境窗口有效累计 ${s.validMin} min，未达要求 ${win.requiredMin} min` };
  }
  if (p.envLegacyConfirmed) return { ok: true };
  return { ok: false, reason: '旧数据无连续读数，请在下方人工确认后再完成' };
}

export const useProcedureStore = create<ProcedureState>((set, get) => ({
  items: [],
  loaded: false,
  async load() {
    const items = await db.procedures.toArray();
    items.sort((a, b) => a.seq - b.seq || a.startedAt - b.startedAt);
    set({ items, loaded: true });
  },
  async add(draft) {
    const record: PrepProcedure = { ...draft, id: newId('prc') };
    await db.procedures.put(record);
    set({ items: [...get().items, record] });
    return record;
  },
  async attachEnvWindow(id, windowId, lotId) {
    const patch: Partial<PrepProcedure> = { envWindowId: windowId, adhesiveLotId: lotId };
    await db.procedures.update(id, patch);
    set({ items: get().items.map((it) => (it.id === id ? { ...it, ...patch } : it)) });
  },
  async finish(id) {
    const patch: Partial<PrepProcedure> = { state: 'done', finishedAt: Date.now() };
    await db.procedures.update(id, patch);
    set({ items: get().items.map((it) => (it.id === id ? { ...it, ...patch } : it)) });
  },
  async confirmLegacy(id) {
    const patch: Partial<PrepProcedure> = { envLegacyConfirmed: true };
    await db.procedures.update(id, patch);
    set({ items: get().items.map((it) => (it.id === id ? { ...it, ...patch } : it)) });
  },
  async rollback(id) {
    // 回退释放对应胶种批次：窗口标记 released，不再锁定批次，读数留痕保留
    const target = get().items.find((it) => it.id === id);
    if (target?.envWindowId) {
      await useEnvWindowStore.getState().release(target.envWindowId);
    }
    const patch: Partial<PrepProcedure> = { state: 'rolledback', finishedAt: undefined };
    await db.procedures.update(id, patch);
    set({ items: get().items.map((it) => (it.id === id ? { ...it, ...patch } : it)) });
  },
  async remove(id) {
    const target = get().items.find((it) => it.id === id);
    if (target?.envWindowId) {
      await useEnvWindowStore.getState().remove(target.envWindowId);
    }
    await db.procedures.delete(id);
    set({ items: get().items.filter((it) => it.id !== id) });
  },
  bySpecimen(specimenId) {
    return get()
      .items.filter((it) => it.specimenId === specimenId)
      .sort((a, b) => a.seq - b.seq);
  },
}));
