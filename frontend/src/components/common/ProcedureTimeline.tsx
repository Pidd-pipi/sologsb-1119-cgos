import { useState } from 'react';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Button from '@mui/material/Button';
import Collapse from '@mui/material/Collapse';
import Divider from '@mui/material/Divider';
import Paper from '@mui/material/Paper';
import Tooltip from '@mui/material/Tooltip';
import Alert from '@mui/material/Alert';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import UndoIcon from '@mui/icons-material/Undo';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import type { PrepProcedure } from '../../types/procedure';
import { useEnvWindowStore } from '../../stores/envWindowStore';
import { envStats, formatMin, procedureNeedsEnv } from '../../types/envWindow';
import { canFinishProcedure } from '../../stores/procedureStore';
import { EnvWindowPanel } from './EnvWindowPanel';

export interface ProcedureTimelineProps {
  items: PrepProcedure[];
  onFinish?: (id: string) => void;
  onRollback?: (id: string) => void;
  onOpenPhoto?: (procedureId: string) => void;
  onConfirmLegacy?: (id: string) => void;
  onToast?: (msg: string) => void;
}

function fmtTime(ts?: number): string {
  if (!ts) return '—';
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * 纵向工序节点流：步骤图标、状态、连续环境窗口（多次读数/有效累计/暂停记录）。
 * 被标本详情页、工序录入页消费。三处视图共用同一 envStats，时长口径一致。
 */
export function ProcedureTimeline({ items, onFinish, onRollback, onOpenPhoto, onConfirmLegacy, onToast }: ProcedureTimelineProps) {
  const [expanded, setExpanded] = useState<string | null>(items[0]?.id ?? null);
  const windows = useEnvWindowStore((s) => s.items);

  if (items.length === 0) {
    return (
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="body2" color="text.secondary">
          该标本暂无工序节点，请到「新建工序节点」登记。
        </Typography>
      </Paper>
    );
  }

  return (
    <Stack spacing={1} data-testid="procedure-timeline">
      {items.map((node, index) => {
        const isDone = node.state === 'done';
        const open = expanded === node.id;
        const win = windows.find((w) => w.procedureId === node.id);
        const stats = win ? envStats(win) : undefined;
        const needsEnv = procedureNeedsEnv(node);
        const legacyPending = needsEnv && !win && !node.envLegacyConfirmed;
        const finishCheck = node.state === 'pending' ? canFinishProcedure(node) : { ok: true as const };
        const headDuration = win ? formatMin(stats!.validMin) : `${node.durationMin} min`;
        return (
          <Box key={node.id} sx={{ display: 'flex', gap: 1.5 }}>
            <Stack alignItems="center" sx={{ pt: 0.5 }}>
              {isDone ? (
                <CheckCircleIcon color="success" fontSize="small" />
              ) : (
                <RadioButtonUncheckedIcon color={node.state === 'rolledback' ? 'error' : 'disabled'} fontSize="small" />
              )}
              {index < items.length - 1 ? (
                <Box sx={{ flex: 1, width: '2px', minHeight: 32, bgcolor: 'divider', my: 0.5 }} />
              ) : null}
            </Stack>
            <Paper variant="outlined" sx={{ p: 1.5, flex: 1, mb: 0.5 }}>
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                <Chip size="small" label={`#${node.seq}`} color="primary" variant="outlined" />
                <Typography variant="subtitle2" fontWeight={700}>
                  {node.stepType} · {node.nodeName}
                </Typography>
                <Chip
                  size="small"
                  label={node.state === 'done' ? '已完成' : node.state === 'rolledback' ? '已回退' : '待办'}
                  color={isDone ? 'success' : node.state === 'rolledback' ? 'error' : 'default'}
                />
                <Typography variant="caption" color="text.secondary">
                  {win ? '有效累计 ' : '耗时 '}
                  {headDuration}
                  {win ? ` / 要求 ${formatMin(win.requiredMin)}` : ''} · 责任人 {node.operator}
                </Typography>
                {win ? (
                  <Chip
                    size="small"
                    color={win.status === 'finished' ? 'success' : win.status === 'released' ? 'default' : 'primary'}
                    variant="outlined"
                    label={
                      win.status === 'finished'
                        ? '窗口已结束'
                        : win.status === 'released'
                          ? '窗口已释放'
                          : stats?.met
                            ? '有效时长已达标'
                            : '固化监测中'
                    }
                  />
                ) : null}
                <Box sx={{ flex: 1 }} />
                {!isDone && onFinish && !win && finishCheck.ok ? (
                  <Button size="small" variant="contained" onClick={() => onFinish(node.id)}>
                    完成节点
                  </Button>
                ) : null}
                {!isDone && onFinish && win && win.status !== 'active' ? (
                  <Button size="small" variant="contained" onClick={() => onFinish(node.id)}>
                    完成节点
                  </Button>
                ) : null}
                {isDone && onRollback ? (
                  <Button size="small" color="warning" startIcon={<UndoIcon />} onClick={() => onRollback(node.id)}>
                    回退节点
                  </Button>
                ) : null}
                <Tooltip title={open ? '收起环境参数' : '展开环境参数'}>
                  <IconButton size="small" onClick={() => setExpanded(open ? null : node.id)}>
                    <ExpandMoreIcon
                      fontSize="small"
                      sx={{ transform: open ? 'rotate(180deg)' : 'none', transition: '0.2s' }}
                    />
                  </IconButton>
                </Tooltip>
              </Stack>
              {node.state === 'pending' && !finishCheck.ok && finishCheck.reason ? (
                <Alert severity="warning" sx={{ mt: 1, py: 0 }}>
                  {finishCheck.reason}
                </Alert>
              ) : null}
              <Collapse in={open} unmountOnExit>
                <Divider sx={{ my: 1 }} />
                <Stack direction="row" spacing={2} flexWrap="wrap" rowGap={0.5}>
                  <Typography variant="body2">工具：{node.tools.length ? node.tools.join('、') : '—'}</Typography>
                  <Typography variant="body2">磨料：{node.abrasive || '—'}</Typography>
                  <Typography variant="body2">
                    胶种：{node.adhesive || '—'}
                    {node.adhesiveConc > 0 ? `（浓度 ${node.adhesiveConc} %）` : ''}
                  </Typography>
                  {!win ? (
                    <Typography variant="body2">
                      环境：{node.tempC} ℃ / RH {node.rh} %
                    </Typography>
                  ) : null}
                  <Typography variant="body2">开始：{fmtTime(node.startedAt)}</Typography>
                  <Typography variant="body2">结束：{fmtTime(node.finishedAt)}</Typography>
                  <Typography variant="body2">
                    影像：前 {node.photoBeforeIds.length} 张 / 后 {node.photoAfterIds.length} 张
                  </Typography>
                  {onOpenPhoto ? (
                    <Button size="small" onClick={() => onOpenPhoto(node.id)}>
                      查看对照
                    </Button>
                  ) : null}
                </Stack>

                {win ? (
                  <EnvWindowPanel
                    window={win}
                    onToast={(m) => onToast?.(m)}
                    onWindowFinished={() => onFinish?.(node.id)}
                  />
                ) : null}

                {legacyPending ? (
                  <Alert
                    severity="info"
                    sx={{ mt: 1 }}
                    action={
                      onConfirmLegacy ? (
                        <Button
                          color="inherit"
                          size="small"
                          onClick={() => onConfirmLegacy(node.id)}
                          data-testid={`legacy-confirm-${node.id}`}
                        >
                          人工确认
                        </Button>
                      ) : undefined
                    }
                  >
                    该工序为旧数据升级而来，无连续环境窗口读数。
                    {node.state === 'done' ? '完成状态保留，确认后归档按单次温湿度记录处理。' : '请人工核实固化条件后确认，方可完成节点。'}
                  </Alert>
                ) : null}
              </Collapse>
            </Paper>
          </Box>
        );
      })}
    </Stack>
  );
}

export default ProcedureTimeline;
