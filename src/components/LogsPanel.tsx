import type { AuditLog } from '../engine/types';
import { fmtTime } from './ui';

const LABEL: Record<string, string> = {
  create: '创建配置',
  edit: '修改配置/规则',
  start_testing: '开始测试',
  start_gray: '开始灰度',
  expand_gray: '扩大灰度范围',
  full_release: '全部发布',
  emergency_release: '紧急发布',
  rollback: '回滚',
  conflict_blocked: '冲突拦截',
  conflict_forced: '冲突后继续',
  reset: '重置数据',
};

export function LogsPanel({ logs }: { logs: AuditLog[] }) {
  return (
    <table>
      <thead>
        <tr>
          <th style={{ width: 150 }}>时间</th>
          <th style={{ width: 110 }}>操作类型</th>
          <th>配置 / 详情</th>
          <th style={{ width: 120 }}>版本变化</th>
          <th style={{ width: 80 }}>结果</th>
        </tr>
      </thead>
      <tbody>
        {logs.map((log) => (
          <tr key={log.id}>
            <td className="mono">{fmtTime(log.time)}</td>
            <td>{LABEL[log.action] ?? log.action}</td>
            <td>
              <strong>{log.configName}</strong>
              <div className="muted">{log.detail}</div>
            </td>
            <td className="mono">
              {log.fromVersion ? `v${log.fromVersion} → ` : ''}
              {log.version ? `v${log.version}` : '-'}
              {log.toVersion ? ` (内容=v${log.toVersion})` : ''}
            </td>
            <td>
              <span
                className={
                  log.result === 'success'
                    ? 'trace-ok'
                    : log.result === 'blocked'
                      ? 'trace-no'
                      : ''
                }
              >
                {log.result === 'success'
                  ? '成功'
                  : log.result === 'blocked'
                    ? '已阻止'
                    : '记录'}
              </span>
            </td>
          </tr>
        ))}
        {logs.length === 0 && (
          <tr>
            <td colSpan={5} className="muted">
              暂无操作记录。
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
