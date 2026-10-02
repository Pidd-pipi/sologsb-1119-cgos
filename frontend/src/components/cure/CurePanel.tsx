import { useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Alert from '@mui/material/Alert';
import LinearProgress from '@mui/material/LinearProgress';
import Divider from '@mui/material/Divider';
import Tooltip from '@mui/material/Tooltip';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import PauseIcon from '@mui/icons-material/Pause';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import HistoryIcon from '@mui/icons-material/History';
import { useCureStore } from '../../stores/cureStore';
import { useSupplyStore } from '../../stores/supplyStore';
import { useSpecimenStore } from '../../stores/specimenStore';
import { useProcedureStore } from '../../stores/procedureStore';
import { useProcedureCure } from '../../hooks/useProcedureCure';
import { MeasureField } from '../common/MeasureField';
import {
  fmtMin,
  fmtClock,
  type CureWindow,
  type CureRange,
  type CurePause,
} from '../../types/cure';
import type { PrepProcedure } from '../../types/procedure';

/** 工序是否涉及胶种固化（需要连续环境窗口） */
export function procedureUsesAdhesive(proc: PrepProcedure): boolean {
  return ['加固', '粘接', '补配'].includes(proc.stepType) && !!proc.adhesive;
}

const STATUS_LABEL: Record<CureWindow['status'], string> = {
  running: '运行中',
  paused: '已暂停',
  closed: '已关闭',
};

const STATUS_COLOR: Record<CureWindow['status'], 'success' | 'warning' | 'default'> = {
  running: 'success',
  paused: 'warning',
  closed: 'default',
};

function defaultRange(proc: PrepProcedure): CureRange {
  return {
    tempMin: Math.round((proc.tempC - 2) * 10) / 10,
    tempMax: Math.round((proc.tempC + 2) * 10) / 10,
    rhMin: Math.max(0, proc.rh - 5),
    rhMax: Math.min(100, proc.rh + 5),
  };
}

/** 单条暂停记录文案 */
function pauseLine(p: CurePause): string {
  const resume = p.resumedAt ? ` → 恢复 ${fmtClock(p.resumedAt)}` : ' → 未恢复';
  return `${fmtClock(p.pausedAt)} ${p.reason}${resume}`;
}

export function CurePanel({ procedure: proc }: { procedure: PrepProcedure }) {
  const specimen = useSpecimenStore((s) => s.items.find((it) => it.id === proc.specimenId));
  const glueLots = useSupplyStore((s) => s.items.filter((l) => l.kind === '胶种'));
  const startWindow = useCureStore((s) => s.startWindow);
  const takeReading = useCureStore((s) => s.takeReading);
  const reportStop = useCureStore((s) => s.reportStop);
  const reportResume = useCureStore((s) => s.reportResume);
  const closeWindow = useCureStore((s) => s.closeWindow);
  const manualConfirm = useCureStore((s) => s.manualConfirm);
  const updateProcedure = useProcedureStore((s) => s.update);

  const cure = useProcedureCure(proc.id);
  const [error, setError] = useState('');

  const [startOpen, setStartOpen] = useState(false);
  const [readingOpen, setReadingOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);

  // 开始窗口表单
  const [lotId, setLotId] = useState('');
  const [requiredMin, setRequiredMin] = useState(proc.durationMin || 60);
  const [range, setRange] = useState<CureRange>(defaultRange(proc));
  const [usedQty, setUsedQty] = useState(1);
  const [operator, setOperator] = useState(proc.operator || '');

  // 读数表单
  const [tempC, setTempC] = useState(proc.tempC);
  const [rh, setRh] = useState(proc.rh);

  // 人工确认表单
  const [manualMin, setManualMin] = useState(proc.durationMin || 60);
  const [manualTemp, setManualTemp] = useState(proc.tempC);
  const [manualRh, setManualRh] = useState(proc.rh);
  const [manualOperator, setManualOperator] = useState(proc.operator || '');

  const eligibleLots = useMemo(() => glueLots.filter((l) => l.qty > 0), [glueLots]);

  if (!procedureUsesAdhesive(proc)) {
    return (
      <Typography variant="body2" color="text.secondary">
        该工序不涉及胶种固化，无需连续环境窗口。
      </Typography>
    );
  }

  // 旧数据升级：无连续读数，需人工确认
  if (proc.needsCureConfirm) {
    const submitManual = async () => {
      if (!Number.isFinite(manualMin) || manualMin <= 0) {
        setError('请填写有效的固化时长');
        return;
      }
      await manualConfirm({
        procedureId: proc.id,
        specimenId: proc.specimenId,
        supplyLotId: '',
        adhesive: proc.adhesive,
        range: { tempMin: manualTemp, tempMax: manualTemp, rhMin: manualRh, rhMax: manualRh },
        manualMin,
        operator: manualOperator.trim() || proc.operator,
      });
      await updateProcedure(proc.id, { needsCureConfirm: false });
      setManualOpen(false);
      setError('');
    };

    return (
      <Stack spacing={1}>
        <Alert severity="warning" sx={{ py: 0 }}>
          旧数据升级：该工序无连续环境读数，需人工确认固化时长与暂停记录。
        </Alert>
        <Box>
          <Button size="small" variant="outlined" startIcon={<CheckCircleIcon />} onClick={() => setManualOpen(true)}>
            人工确认固化记录
          </Button>
        </Box>
        <Dialog open={manualOpen} onClose={() => setManualOpen(false)} fullWidth maxWidth="xs">
          <DialogTitle>人工确认固化记录</DialogTitle>
          <DialogContent dividers>
            <Stack spacing={1.5} sx={{ mt: 0.5 }}>
              {error ? <Alert severity="error">{error}</Alert> : null}
              <Typography variant="body2" color="text.secondary">
                {proc.stepType} · {proc.nodeName}（{specimen?.specimenNo}）
              </Typography>
              <MeasureField label="有效固化时长" unit="min" min={1} max={100000} step={1} value={manualMin} onChange={setManualMin} />
              <Stack direction="row" spacing={1.5}>
                <MeasureField label="记录温度" unit="℃" min={-10} max={60} step={0.5} value={manualTemp} onChange={setManualTemp} />
                <MeasureField label="记录湿度" unit="%" min={0} max={100} step={1} value={manualRh} onChange={setManualRh} />
              </Stack>
              <TextField size="small" label="确认人" value={manualOperator} onChange={(e) => setManualOperator(e.target.value)} />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setManualOpen(false)}>取消</Button>
            <Button variant="contained" onClick={submitManual}>
              确认
            </Button>
          </DialogActions>
        </Dialog>
      </Stack>
    );
  }

  const open = cure.open;
  const required = open?.requiredMin ?? requiredMin;
  const progressPct = required > 0 ? Math.min(100, (cure.totalEffectiveMin / required) * 100) : 0;
  const lotName = (id: string) => glueLots.find((l) => l.id === id)?.name ?? '—';

  const openStart = () => {
    const preferred = eligibleLots.find((l) => l.name === proc.adhesive) ?? eligibleLots[0];
    setLotId(preferred?.id ?? '');
    setRequiredMin(proc.durationMin || 60);
    setRange(defaultRange(proc));
    setUsedQty(1);
    setOperator(proc.operator || '');
    setError('');
    setStartOpen(true);
  };

  const submitStart = async () => {
    if (!lotId) {
      setError('请选择锁定的胶种批次');
      return;
    }
    if (!Number.isFinite(requiredMin) || requiredMin <= 0) {
      setError('要求时长需大于 0');
      return;
    }
    if (!Number.isFinite(usedQty) || usedQty <= 0) {
      setError('用量需大于 0');
      return;
    }
    if (open) {
      setError('已有未关闭的窗口，请先结束或回退');
      return;
    }
    await startWindow({
      procedureId: proc.id,
      specimenId: proc.specimenId,
      specimenNo: specimen?.specimenNo ?? '未关联标本',
      supplyLotId: lotId,
      adhesive: proc.adhesive,
      range,
      requiredMin,
      usedQty,
      operator: operator.trim() || proc.operator,
    });
    setStartOpen(false);
    setError('');
  };

  const submitReading = async () => {
    if (!open) return;
    if (!Number.isFinite(tempC) || !Number.isFinite(rh)) {
      setError('请填写有效的温湿度读数');
      return;
    }
    await takeReading(open.id, tempC, rh);
    setReadingOpen(false);
    setError('');
  };

  const submitClose = async () => {
    if (!open) return;
    const res = await closeWindow(open.id);
    if (!res.ok) setError(res.error ?? '结束失败');
    else setError('');
  };

  return (
    <Stack spacing={1}>
      <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap">
        <Typography variant="body2" fontWeight={700}>
          连续环境窗口
        </Typography>
        {open ? <Chip size="small" color={STATUS_COLOR[open.status]} label={STATUS_LABEL[open.status]} /> : <Chip size="small" variant="outlined" label="未开始" />}
        <Box sx={{ flex: 1 }} />
        {!open ? (
          <Button size="small" variant="contained" startIcon={<PlayArrowIcon />} onClick={openStart} disabled={eligibleLots.length === 0}>
            开始养护窗口
          </Button>
        ) : (
          <>
            <Button size="small" startIcon={<HistoryIcon />} onClick={() => { setTempC(proc.tempC); setRh(proc.rh); setError(''); setReadingOpen(true); }}>
              记录读数
            </Button>
            {open.status === 'running' ? (
              <Tooltip title="停机：暂停计入，恢复后续计">
                <Button size="small" color="warning" startIcon={<PauseIcon />} onClick={() => reportStop(open.id, '停机')}>
                  停机
                </Button>
              </Tooltip>
            ) : (
              <Button size="small" color="success" startIcon={<PlayArrowIcon />} onClick={() => reportResume(open.id)}>
                恢复
              </Button>
            )}
            <Button size="small" variant="contained" startIcon={<CheckCircleIcon />} onClick={submitClose}>
              结束窗口
            </Button>
          </>
        )}
      </Stack>

      {eligibleLots.length === 0 && !open ? (
        <Alert severity="info" sx={{ py: 0 }}>
          暂无可用胶种批次（在库为 0），请先到「材料台账」登记。
        </Alert>
      ) : null}

      {/* 有效累计时长 */}
      <Box>
        <Stack direction="row" spacing={1} alignItems="baseline">
          <Typography variant="body2" color="text.secondary">
            有效累计时长：
          </Typography>
          <Typography variant="body2" fontWeight={700} color={cure.totalEffectiveMin >= required ? 'success.main' : 'text.primary'}>
            {fmtMin(Math.round(cure.totalEffectiveMin))}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            / 要求 {fmtMin(required)}
          </Typography>
        </Stack>
        <LinearProgress
          variant="determinate"
          value={progressPct}
          color={cure.totalEffectiveMin >= required ? 'success' : 'primary'}
          sx={{ height: 6, borderRadius: 3, mt: 0.5 }}
        />
      </Box>

      <Stack direction="row" spacing={2} flexWrap="wrap">
        <Typography variant="body2">锁定批次：{open ? `${open.adhesive}（${lotName(open.supplyLotId)}）` : '—'}</Typography>
        <Typography variant="body2">读数 {cure.readingCount} 次</Typography>
        <Typography variant="body2">暂停 {cure.pauseCount} 次</Typography>
      </Stack>

      {error ? <Alert severity="error" sx={{ py: 0 }}>{error}</Alert> : null}

      {/* 暂停记录 */}
      {cure.pauses.length > 0 ? (
        <Box>
          <Typography variant="caption" color="text.secondary">
            暂停记录：
          </Typography>
          <Stack spacing={0.25}>
            {cure.pauses.map((p) => (
              <Typography key={p.id} variant="caption" color="text.secondary">
                · {pauseLine(p)}
              </Typography>
            ))}
          </Stack>
        </Box>
      ) : null}

      {/* 历史窗口 */}
      {cure.windows.length > 1 ? (
        <Box>
          <Divider sx={{ my: 0.5 }} />
          <Typography variant="caption" color="text.secondary">
            历史窗口（{cure.windows.length}）：
          </Typography>
          {cure.windows.map((w) => (
            <Typography key={w.id} variant="caption" color="text.secondary" display="block">
              {fmtClock(w.startedAt)} ~ {w.endedAt ? fmtClock(w.endedAt) : '进行中'} · {STATUS_LABEL[w.status]} · 有效 {fmtMin(Math.round(w.effectiveMin))}
              {w.manualConfirmed ? '（人工确认）' : ''}
            </Typography>
          ))}
        </Box>
      ) : null}

      {/* 开始窗口 */}
      <Dialog open={startOpen} onClose={() => setStartOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>开始养护窗口 · 锁定胶种批次与范围</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1.5} sx={{ mt: 0.5 }}>
            {error ? <Alert severity="error">{error}</Alert> : null}
            <TextField select size="small" label="锁定胶种批次" value={lotId} onChange={(e) => setLotId(e.target.value)}>
              {eligibleLots.map((l) => (
                <MenuItem key={l.id} value={l.id}>
                  {l.name} · 批号 {l.lotNo} · 在库 {l.qty} {l.unit}
                </MenuItem>
              ))}
            </TextField>
            <Stack direction="row" spacing={1.5}>
              <MeasureField label="要求有效时长" unit="min" min={1} max={100000} step={1} value={requiredMin} onChange={setRequiredMin} />
              <MeasureField label="本次用量" unit={glueLots.find((l) => l.id === lotId)?.unit ?? '份'} min={0} max={100000} step={0.5} value={usedQty} onChange={setUsedQty} />
            </Stack>
            <Typography variant="caption" color="text.secondary">
              验收范围（锁定后读数超出即记为超标并暂停）：
            </Typography>
            <Stack direction="row" spacing={1.5}>
              <MeasureField label="温度下限" unit="℃" min={-10} max={60} step={0.5} value={range.tempMin} onChange={(v) => setRange({ ...range, tempMin: v })} />
              <MeasureField label="温度上限" unit="℃" min={-10} max={60} step={0.5} value={range.tempMax} onChange={(v) => setRange({ ...range, tempMax: v })} />
            </Stack>
            <Stack direction="row" spacing={1.5}>
              <MeasureField label="湿度下限" unit="%" min={0} max={100} step={1} value={range.rhMin} onChange={(v) => setRange({ ...range, rhMin: v })} />
              <MeasureField label="湿度上限" unit="%" min={0} max={100} step={1} value={range.rhMax} onChange={(v) => setRange({ ...range, rhMax: v })} />
            </Stack>
            <TextField size="small" label="责任人" value={operator} onChange={(e) => setOperator(e.target.value)} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setStartOpen(false)}>取消</Button>
          <Button variant="contained" onClick={submitStart}>
            锁定并开始
          </Button>
        </DialogActions>
      </Dialog>

      {/* 记录读数 */}
      <Dialog open={readingOpen} onClose={() => setReadingOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>记录温湿度读数</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1.5} sx={{ mt: 0.5 }}>
            {error ? <Alert severity="error">{error}</Alert> : null}
            <Stack direction="row" spacing={1.5}>
              <MeasureField label="环境温度" unit="℃" min={-10} max={60} step={0.5} value={tempC} onChange={setTempC} />
              <MeasureField label="相对湿度" unit="%" min={0} max={100} step={1} value={rh} onChange={setRh} />
            </Stack>
            <Typography variant="caption" color="text.secondary">
              读数超标将自动暂停（停机/超标时段不计入有效时长），恢复达标后自动续计。
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setReadingOpen(false)}>取消</Button>
          <Button variant="contained" onClick={submitReading}>
            保存读数
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

export default CurePanel;
