import { useMemo, useState } from 'react';
import type {
  ConfigProject,
  ConfigStatus,
  DemoUser,
} from '../engine/types';
import { evaluate } from '../engine/rules';
import { KVView } from './ui';
import { statusLabel } from '../state/store';

export function PreviewPanel({
  project,
  users,
  overrideSnapshot,
  overrideNote,
}: {
  project: ConfigProject;
  users: DemoUser[];
  overrideSnapshot?: ConfigProject['versions'][number]['snapshot'];
  overrideNote?: string;
}) {
  const [userId, setUserId] = useState(users[0]?.id ?? '');
  const [simStatus, setSimStatus] = useState<ConfigStatus | ''>('');
  const [simPercent, setSimPercent] = useState<number>(10);

  const user = users.find((u) => u.id === userId) ?? users[0];

  const simulated: ConfigProject = useMemo(() => {
    const base: ConfigProject = structuredClone(project);
    if (overrideSnapshot) {
      const cur = base.versions.find((v) => v.version === base.currentVersion)!;
      cur.snapshot = structuredClone(overrideSnapshot);
    }
    if (simStatus) {
      base.status = simStatus;
      if (simStatus === 'gray') base.grayPercent = simPercent;
      if (simStatus === 'full') base.grayPercent = 100;
    }
    return base;
  }, [project, overrideSnapshot, simStatus, simPercent]);

  if (!user)
    return <div className="banner warn">暂无演示用户，请先在开始页载入演示数据。</div>;

  const result = evaluate(simulated, user);

  return (
    <div>
      <div className="grid grid-2">
        <label className="field">
          <span>选择测试用户</span>
          <select value={userId} onChange={(e) => setUserId(e.target.value)}>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.id} · {u.name}（{u.region}/{u.device}
                {u.tags.length ? '/' + u.tags.join(',') : ''}）
              </option>
            ))}
          </select>
        </label>
        <div className="field">
          <span>模拟发布状态（默认使用配置当前真实状态）</span>
          <div className="row">
            <select
              value={simStatus}
              onChange={(e) => setSimStatus(e.target.value as ConfigStatus | '')}
            >
              <option value="">真实状态：{statusLabel(project.status)}</option>
              <option value="draft">草稿</option>
              <option value="testing">测试中</option>
              <option value="gray">灰度发布</option>
              <option value="full">全部发布</option>
              <option value="rolled_back">已回滚</option>
            </select>
            {simStatus === 'gray' && (
              <input
                type="number"
                min={1}
                max={100}
                value={simPercent}
                onChange={(e) => setSimPercent(Number(e.target.value))}
                style={{ width: 90 }}
              />
            )}
            {simStatus === 'gray' && <span className="muted">% 全局上限</span>}
          </div>
        </div>
      </div>

      {overrideNote && <div className="banner info">{overrideNote}</div>}
      <div className="banner info">{result.gateReason}</div>

      <div
        className="banner"
        style={{
          background: result.variant === 'new' ? '#f0fdf4' : '#f8fafc',
          borderColor: result.variant === 'new' ? '#86efac' : '#cbd5e1',
        }}
      >
        <strong>
          最终结果：用户 {user.id} 命中
          {result.variant === 'new'
            ? `【新配置】规则「${result.matchedRuleName}」`
            : '【默认/旧配置】（没有任何规则在当前状态与比例下放行）'}
        </strong>
        <div style={{ marginTop: 6 }}>
          下发内容：<KVView data={result.output} />
        </div>
      </div>

      <h3>判断过程（按优先级从高到低逐条判断）</h3>
      {result.traces.length === 0 && (
        <div className="muted">当前版本没有任何规则，直接返回默认配置。</div>
      )}
      {result.traces.map((trace) => (
        <div
          key={trace.ruleId}
          className={`trace-box ${trace.hit ? 'hit' : 'skipped'}`}
        >
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <strong>
              P{trace.priority} · {trace.ruleName}{' '}
              {trace.hit && <span className="trace-ok">✅ 最终命中</span>}
            </strong>
            {!trace.enabled && <span className="trace-no">{trace.skipReason}</span>}
          </div>
          {trace.enabled && (
            <>
              <table>
                <tbody>
                  {trace.conditionTraces.map((c) => (
                    <tr key={c.dimension}>
                      <td style={{ width: 90 }}>{c.dimension}</td>
                      <td style={{ width: 160 }}>要求：{c.expected}</td>
                      <td>实际：{c.actual}</td>
                      <td style={{ width: 80 }} className={c.pass ? 'trace-ok' : 'trace-no'}>
                        {c.pass ? '✓ 满足' : '✗ 不满足'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {trace.conditionsMatched && (
                <div className="muted" style={{ marginTop: 4 }}>
                  {trace.percent === 100 ? (
                    <>
                      条件全部满足 → 定向规则（比例 100%），不受全局灰度上限限制：
                      <span className="trace-ok"> ✓ 直接放行</span>
                    </>
                  ) : (
                    <>
                      条件全部满足 → 稳定桶号 <strong>{trace.bucket}</strong>（同一用户恒定），
                      有效比例 <strong>{trace.percent}%</strong>（桶号 0 ~ {trace.percent! - 1}{' '}
                      放行）：
                      <span className={trace.percentPassed ? 'trace-ok' : 'trace-no'}>
                        {trace.percentPassed ? ' ✓ 比例放行' : ' ✗ ' + trace.skipReason}
                      </span>
                    </>
                  )}
                </div>
              )}
              {!trace.conditionsMatched && (
                <div className="muted trace-no" style={{ marginTop: 4 }}>
                  {trace.skipReason}，继续判断下一条
                </div>
              )}
              {trace.conditionsMatched && trace.percentPassed === false && (
                <div className="muted" style={{ marginTop: 4 }}>
                  未进入比例放量，继续判断下一条低优先级规则。
                </div>
              )}
            </>
          )}
        </div>
      ))}
    </div>
  );
}
