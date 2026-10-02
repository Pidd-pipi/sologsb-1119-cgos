import { create } from 'zustand';
import { db } from '../utils/db';
import { newId } from '../utils/id';
import {
  envStats,
  isReadingInRange,
  type EnvReading,
  type EnvWindow,
  type EnvWindowDraft,
} from '../types/envWindow';

interface EnvWindowState {
  items: EnvWindow[];
  loaded: boolean;
  load: () => Promise<void>;
  start: (draft: EnvWindowDraft) => Promise<EnvWindow>;
  addReading: (
    windowId: string,
    reading: { tempC: number; rh: number; note?: string; at?: number },
  ) => Promise<EnvWindow | null>;
  pause: (windowId: string, reason: string) => Promise<void>;
  resume: (windowId: string) => Promise<void>;
  /** 心跳：页面开着时允许实时尾部计时；关页后尾部冻结在最后心跳 */
  heartbeat: (windowId: number | string) => Promise<void>;
  /** 达标后结束窗口，返回有效毫秒数；未达标返回 null */
  finish: (windowId: string) => Promise<{ validMs: number; validMin: number } | null>;
  /** 回退工序时释放窗口（释放胶种批次锁定，读数留痕保留） */
  release: (windowId: string) => Promise<void>;
  remove: (windowId: string) => Promise<void>;
  byProcedure: (procedureId: string) => EnvWindow | undefined;
  /** 某胶种批次当前进行中的窗口 */
  activeByLot: (lotId: string) => EnvWindow[];
}

export const useEnvWindowStore = create<EnvWindowState>((set, get) => ({
  items: [],
  loaded: false,
  async load() {
    const items = await db.envWindows.toArray();
    items.sort((a, b) => a.startedAt - b.startedAt);
    set({ items, loaded: true });
  },
  async start(draft) {
    const now = Date.now();
    const record: EnvWindow = {
      ...draft,
      id: newId('env'),
      status: 'active',
      readings: [],
      pauses: [],
      observedUntil: now,
    };
    await db.envWindows.put(record);
    set({ items: [...get().items, record] });
    return record;
  },
  async addReading(windowId, { tempC, rh, note, at }) {
    const target = get().items.find((it) => it.id === windowId);
    if (!target || target.status !== 'active') return null;
    const now = Date.now();
    const atTs = at ?? now;
    const inRange = isReadingInRange({ tempC, rh }, target);
    // 同一时刻重复保存（双页并发）只保留一条，避免重复计时
    const deduped = target.readings.filter((r) => r.at !== atTs);
    const reading: EnvReading = { id: newId('rdg'), at: atTs, tempC, rh, inRange, note: note?.trim() || undefined };
    const next: EnvWindow = {
      ...target,
      readings: [...deduped, reading].sort((a, b) => a.at - b.at),
      observedUntil: Math.max(target.observedUntil, now),
    };
    await db.envWindows.put(next);
    set({ items: get().items.map((it) => (it.id === windowId ? next : it)) });
    return next;
  },
  async pause(windowId, reason) {
    const target = get().items.find((it) => it.id === windowId);
    if (!target || target.status !== 'active') return;
    if (target.pauses.some((p) => p.to === undefined)) return;
    const next: EnvWindow = {
      ...target,
      pauses: [...target.pauses, { id: newId('pau'), from: Date.now(), reason: reason.trim() || '设备停机', kind: 'manual' }],
    };
    await db.envWindows.put(next);
    set({ items: get().items.map((it) => (it.id === windowId ? next : it)) });
  },
  async resume(windowId) {
    const target = get().items.find((it) => it.id === windowId);
    if (!target || target.status !== 'active') return;
    const now = Date.now();
    const pauses = target.pauses.map((p) => (p.to === undefined ? { ...p, to: now } : p));
    const next: EnvWindow = { ...target, pauses, observedUntil: Math.max(target.observedUntil, now) };
    await db.envWindows.put(next);
    set({ items: get().items.map((it) => (it.id === windowId ? next : it)) });
  },
  async heartbeat(windowId) {
    const target = get().items.find((it) => it.id === windowId);
    if (!target || target.status !== 'active') return;
    const now = Date.now();
    // 限频：5s 内不重复写库
    if (now - target.observedUntil < 5000) return;
    const next: EnvWindow = { ...target, observedUntil: now };
    await db.envWindows.put(next);
    set({ items: get().items.map((it) => (it.id === windowId ? next : it)) });
  },
  async finish(windowId) {
    const target = get().items.find((it) => it.id === windowId);
    if (!target || target.status !== 'active') return null;
    const stats = envStats(target);
    if (!stats.met) return null;
    const now = Date.now();
    const next: EnvWindow = {
      ...target,
      status: 'finished',
      finishedAt: now,
      observedUntil: now,
      validMs: stats.validMs,
    };
    await db.envWindows.put(next);
    set({ items: get().items.map((it) => (it.id === windowId ? next : it)) });
    return { validMs: stats.validMs, validMin: stats.validMin };
  },
  async release(windowId) {
    const target = get().items.find((it) => it.id === windowId);
    if (!target) return;
    if (target.status === 'released') return;
    const now = Date.now();
    const next: EnvWindow = {
      ...target,
      status: 'released',
      releasedAt: now,
      // 进行中被回退：心跳冻结，不再继续累计
      observedUntil: Math.min(target.observedUntil, now),
    };
    await db.envWindows.put(next);
    set({ items: get().items.map((it) => (it.id === windowId ? next : it)) });
  },
  async remove(windowId) {
    await db.envWindows.delete(windowId);
    set({ items: get().items.filter((it) => it.id !== windowId) });
  },
  byProcedure(procedureId) {
    return get().items.find((it) => it.procedureId === procedureId);
  },
  activeByLot(lotId) {
    return get().items.filter((it) => it.adhesiveLotId === lotId && it.status === 'active');
  },
}));
