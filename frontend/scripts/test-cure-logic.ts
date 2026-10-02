import {
  windowRunningIntervals,
  unionIntervals,
  effectiveMinOf,
  recomputeWindow,
  type CureWindow,
} from '../src/types/cure';

let failures = 0;
function check(name: string, actual: number, expected: number) {
  const ok = Math.abs(actual - expected) < 0.01;
  if (!ok) {
    failures++;
    console.error(`FAIL ${name}: expected ${expected}, got ${actual}`);
  } else {
    console.log(`PASS ${name}: ${actual}`);
  }
}

const t0 = 1_000_000;
const min = 60_000;

// Window A: running 0..100, paused 100..130, running 130..200 (closed at 200)
const winA: CureWindow = {
  id: 'a',
  procedureId: 'p',
  specimenId: 's',
  supplyLotId: 'l',
  adhesive: 'x',
  range: { tempMin: 20, tempMax: 25, rhMin: 40, rhMax: 55 },
  requiredMin: 60,
  startedAt: t0,
  endedAt: t0 + 200 * min,
  status: 'closed',
  readings: [],
  pauses: [
    { id: 'p1', pausedAt: t0 + 100 * min, reason: '超标', resumedAt: t0 + 130 * min },
  ],
  effectiveMin: 0,
  createdAt: t0,
  updatedAt: t0,
};

const intsA = windowRunningIntervals(winA, t0 + 200 * min);
check('winA intervals count', intsA.length, 2);
check('winA valid min', (intsA[0][1] - intsA[0][0]) / min + (intsA[1][1] - intsA[1][0]) / min, 170);
check('winA recompute effectiveMin', recomputeWindow(winA, t0 + 200 * min).effectiveMin, 170);

// Window B overlaps A: running 120..200 (overlaps A's 130..200 and the pause 100..130 partially)
const winB: CureWindow = {
  ...winA,
  id: 'b',
  startedAt: t0 + 120 * min,
  endedAt: t0 + 200 * min,
  pauses: [],
};

// A alone = 170; B alone = 80 (120..200); union should NOT double count overlap.
// A intervals: [0,100],[130,200]; B: [120,200].
// Union: [0,100] + [120,200] (since [120,200] overlaps [130,200] -> merged [120,200]).
// Total = 100 + 80 = 180.
const total = effectiveMinOf([winA, winB], t0 + 200 * min);
check('dedup overlapping windows (A=170, B=80, overlap=70 -> 180)', total, 180);

// Manual confirmed window adds its manualMin on top
const winManual: CureWindow = {
  ...winA,
  id: 'm',
  manualConfirmed: true,
  manualMin: 50,
  pauses: [],
};
check('manual window adds manualMin', effectiveMinOf([winManual], t0 + 200 * min), 50);

// Two identical fully-overlapping windows count once
const winC: CureWindow = { ...winA, id: 'c', pauses: [] };
const winD: CureWindow = { ...winA, id: 'd', pauses: [] };
// C: [0,200]=200, D: [0,200]=200 -> union 200
check('fully overlapping windows count once', effectiveMinOf([winC, winD], t0 + 200 * min), 200);

// unionIntervals direct
check('unionIntervals merges overlaps', unionIntervals([[0, 10], [5, 15], [20, 30]]).length, 2);

console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
