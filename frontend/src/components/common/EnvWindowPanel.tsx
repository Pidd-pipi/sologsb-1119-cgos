import { useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import LinearProgress from '@mui/material/LinearProgress';
import Alert from '@mui/material/Alert';
import PauseCircleIcon from '@mui/icons-material/PauseCircle';
import PlayCircleIcon from '@mui/icons-material/PlayCircle';
import TaskAltIcon from '@mui/icons-material/TaskAlt';
import { useEnvWindowStore } from '../../stores/envWindowStore';
import { envProgress, envStats, formatMin, isReadingInRange, type EnvWindow } from '../../types/envWindow';

function fmtClock(ts?: number): string {
  if (!ts) return '—';
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fmtDur(ms: number): string {
  const totalMin = Math.round(ms / 60000);
  return formatMin(totalMin);
}

export interface EnvWindowPanelProps {
  window: EnvWindow;
  /** 窗口达标结束后，通知父级完成工序节点 */
  onWindowFinished: () => void;
  onToast: (msg: string) => void;
}

/**
 * 连续环境窗口面板：多次读数、有效累计、停机/恢复、达标结束。
 * 挂在工序时间线的折叠区内；关页重开读数与累计时长全部保留。
 */
export function EnvWindowPanel({ window: win, onWindowFinished, onToast }: EnvWindowPanelProps) {
  const addReading = useEnvWindowStore((s) => s.addReading);
  const pause = useEnvWindowStore((s) => s.pause);
  const resume = useEnvWindowStore((s) => s.resume);
  const finish = useEnvWindowStore((s) => s.finish);
  const heartbeat = useEnvWindowStore((s) => s.heartbeat);

  const [tempC, setTempC] = useState<number>(win.tempMinC + (win.tempMaxC - win.tempMinC) / 2);
  const [rh, setRh] = useState<number>(Math.round((win.rhMin + win.rhMax) / 2));
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [, setTick] = useState(0);

  const stats = useMemo(() => envStats(win), [win]);
  const progress = envProgress(win);
  const active = win.status === 'active';
  const openManualPause = win.pauses.some((p) => p.to === undefined);

  // 页面开着时每 5s 心跳并刷新实时累计；关页/跳转即停止，尾部冻结在最后心跳
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => {
      void heartbeat(win.id);
      setTick((n) => n + 1);
    }, 5000);
    return () => window.clearInterval(t);
  }, [active, heartbeat, win.id]);

  const submitReading = async () => {
    if (!Number.isFinite(tempC) || !Number.isFinite(rh)) {
      setError('请输入有效的温湿度数值');
      return;
    }
    const inRange = isReadingInRange({ tempC, rh }, win);
    const next = await addReading(win.id, { tempC, rh, note: note.trim() || undefined });
    if (!next) return;
    setError('');
    setNote('');
    onToast(inRange ? '读数已保存，合格区间继续累计' : '读数超标：该时段不计入有效累计，恢复后续算');
  };

  const doPause = async () => {
    await pause(win.id, '设备停机');
    onToast('已登记停机：停机时段不计入有效时长');
  };
  const doResume = async () => {
    await resume(win.id);
    onToast('已恢复监测：恢复后接着累计');
  };
  const doFinish = async () => {
    const res = await finish(win.id);
    if (!res) {
      setError(`有效累计尚未达标（${envStats(win).validMin} / ${win.requiredMin} min），不能结束窗口`);
      return;
    }
    setError('');
    onToast(`窗口已结束，有效累计 ${formatMin(res.validMin)}，正在完成节点…`);
    onWindowFinished();
  };

  const released = win.status === 'released';

  return (
    <Paper
      variant="outlined"
      sx={{ p: 1.5, mt: 1, bgcolor: released ? 'grey.100' : 'action.hover' }}
      data-testid={`env-window-${win.id}`}
    >
      <Stack spacing={1}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
          <Chip
            size="small"
            color={win.status === 'finished' ? 'success' : released ? 'default' : 'primary'}
            label={win.status === 'finished' ? '窗口已结束' : released ? '窗口已释放（回退）' : '固化监测中'}
          />
          <Typography variant="body2" fontWeight={700}>
            胶种批次：{win.adhesive} · {win.adhesiveLotNo}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            合格范围 {win.tempMinC}~{win.tempMaxC} ℃ / RH {win.rhMin}~{win.rhMax}% · 要求有效累计 {win.requiredMin} min
          </Typography>
        </Stack>

        <Box>
          <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
            <Typography variant="caption" color="text.secondary">
              有效累计 {formatMin(Math.round(stats.validMs / 60000))} / {formatMin(win.requiredMin)}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {Math.round(progress * 100)}%
            </Typography>
          </Stack>
          <LinearProgress
            variant="determinate"
            value={Math.round(progress * 100)}
            color={stats.met ? 'success' : 'primary'}
            sx={{ height: 8, borderRadius: 4 }}
          />
        </Box>

        {stats.lastReading ? (
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
            <Chip
              size="small"
              color={stats.lastReading.inRange ? 'success' : 'error'}
              variant="outlined"
              label={`最近读数 ${stats.lastReading.tempC} ℃ / RH ${stats.lastReading.rh}% · ${
                stats.lastReading.inRange ? '合格' : '超标'
              }`}
            />
            <Typography variant="caption" color="text.secondary">
              {fmtClock(stats.lastReading.at)}
              {stats.lastReading.note ? ` · ${stats.lastReading.note}` : ''}
            </Typography>
          </Stack>
        ) : (
          <Typography variant="caption" color="text.secondary">
            尚无读数，请录入第一次温湿度读数开始累计。
          </Typography>
        )}

        {openManualPause ? (
          <Alert severity="warning" data-testid="env-open-pause">
            已停机（{fmtClock(win.pauses.find((p) => p.to === undefined)?.from)}
            起），该时段不计入；复位后点「恢复监测」接着累计。
          </Alert>
        ) : null}

        {active ? (
          <>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} useFlexGap>
              <TextField
                size="small"
                type="number"
                label="本次温度 ℃"
                value={Number.isNaN(tempC) ? '' : tempC}
                onChange={(e) => setTempC(parseFloat(e.target.value))}
                sx={{ width: 140 }}
                inputProps={{ step: 0.5, min: -10, max: 60, 'data-testid': 'env-temp-input' }}
              />
              <TextField
                size="small"
                type="number"
                label="本次湿度 RH %"
                value={Number.isNaN(rh) ? '' : rh}
                onChange={(e) => setRh(parseFloat(e.target.value))}
                sx={{ width: 140 }}
                inputProps={{ step: 1, min: 0, max: 100, 'data-testid': 'env-rh-input' }}
              />
              <TextField
                size="small"
                label="备注（可选）"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                sx={{ flex: 1, minWidth: 160 }}
              />
            </Stack>
            {error ? <Alert severity="error" data-testid="env-error">{error}</Alert> : null}
            <Stack direction="row" spacing={1} flexWrap="wrap">
              <Button size="small" variant="contained" onClick={submitReading} data-testid="env-save-reading">
                保存读数
              </Button>
              {openManualPause ? (
                <Button size="small" color="success" startIcon={<PlayCircleIcon />} onClick={doResume}>
                  恢复监测
                </Button>
              ) : (
                <Button size="small" color="warning" startIcon={<PauseCircleIcon />} onClick={doPause}>
                  停机登记
                </Button>
              )}
              <Button
                size="small"
                color="success"
                variant={stats.met ? 'contained' : 'outlined'}
                startIcon={<TaskAltIcon />}
                disabled={!stats.met}
                onClick={doFinish}
                data-testid="env-finish"
              >
                {stats.met ? '结束窗口并完成节点' : `有效时长未达标（缺 ${formatMin(win.requiredMin - stats.validMin)}）`}
              </Button>
            </Stack>
            {!stats.met && win.readings.length > 0 ? (
              <Typography variant="caption" color="text.secondary">
                固化期间停机或温湿度超标均不能完成；恢复合格后继续累计，达标方可结束。
              </Typography>
            ) : null}
          </>
        ) : (
          <Typography variant="caption" color="text.secondary">
            窗口起止：{fmtClock(win.startedAt)} ~ {fmtClock(win.finishedAt ?? win.releasedAt)} · 有效累计{' '}
            {fmtDur(stats.validMs)}
            {released ? '（胶种批次锁定已释放）' : ''}
          </Typography>
        )}

        {stats.segments.length > 0 ? (
          <>
            <Divider />
            <Box>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                暂停 / 超标记录（共扣减 {fmtDur(stats.pausedMs)}
                {stats.manualPausedMs > 0 ? `，其中停机 ${fmtDur(stats.manualPausedMs)}` : ''}）
              </Typography>
              <Stack spacing={0.5}>
                {stats.segments.map((s, i) => (
                  <Stack key={i} direction="row" spacing={1} alignItems="center">
                    <Chip
                      size="small"
                      color={s.kind === 'manual' ? 'warning' : 'error'}
                      variant="outlined"
                      label={s.kind === 'manual' ? '停机' : '超标'}
                    />
                    <Typography variant="caption">
                      {fmtClock(s.from)} ~ {fmtClock(s.to)} · {s.reason} · {fmtDur(s.to - s.from)}
                    </Typography>
                  </Stack>
                ))}
              </Stack>
            </Box>
          </>
        ) : null}

        {win.readings.length > 0 ? (
          <>
            <Divider />
            <Box>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                读数记录（{win.readings.length} 次，展示最近 6 次）
              </Typography>
              <Stack spacing={0.5}>
                {[...win.readings]
                  .sort((a, b) => b.at - a.at)
                  .slice(0, 6)
                  .map((r) => (
                    <Stack key={r.id} direction="row" spacing={1} alignItems="center">
                      <Chip size="small" color={r.inRange ? 'success' : 'error'} variant="outlined" label={r.inRange ? '合格' : '超标'} />
                      <Typography variant="caption">
                        {fmtClock(r.at)} · {r.tempC} ℃ / RH {r.rh}%{r.note ? ` · ${r.note}` : ''}
                      </Typography>
                    </Stack>
                  ))}
              </Stack>
            </Box>
          </>
        ) : null}
      </Stack>
    </Paper>
  );
}

export default EnvWindowPanel;
