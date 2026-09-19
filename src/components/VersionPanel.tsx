import { useState } from 'react';
import type { ConfigProject } from '../engine/types';
import { diffSnapshots } from '../engine/diff';
import { statusLabel, type ActionResult, type Store } from '../state/store';
import { KVView, fmtTime } from './ui';

const CHANGE_LABEL: Record<string, string> = {
  create: '创建',
  edit: '修改',
  start_testing: '开始测试',
  start_gray: '开始灰度',
  expand_gray: '扩大灰度',
  full_release: '全部发布',
  emergency_release: '紧急发布',
  rollback: '回滚',
};

export function VersionPanel({
  project,
  store,
  onAction,
}: {
  project: ConfigProject;
  store: Store;
  onAction: (
    fn: () => ActionResult<any>,
    ok: string,
    pending?: string,
  ) => boolean;
}) {
  const [compareA, setCompareA] = useState(
    Math.max(1, project.currentVersion - 1),
  );
  const [compareB, setCompareB] = useState(project.currentVersion);
  const [expanded, setExpanded] = useState<number | null>(null);

  const versions = [...project.versions].reverse();
  const va = project.versions.find((v) => v.version === compareA);
  const vb = project.versions.find((v) => v.version === compareB);
  const changes = va && vb ? diffSnapshots(va.snapshot, vb.snapshot) : [];

  return (
    <div>
      <h3>版本列表（历史版本不会因回滚被删除）</h3>
      <table>
        <thead>
          <tr>
            <th style={{ width: 60 }}>版本</th>
            <th style={{ width: 100 }}>类型</th>
            <th>说明 / 状态</th>
            <th style={{ width: 160 }}>时间</th>
            <th style={{ width: 90 }}>稳定性</th>
            <th style={{ width: 230 }}>操作</th>
          </tr>
        </thead>
        <tbody>
          {versions.map((v) => (
            <tr
              key={v.version}
              style={
                v.version === project.currentVersion
                  ? { background: '#eff6ff' }
                  : undefined
              }
            >
              <td>
                <strong>v{v.version}</strong>
                {v.version === project.currentVersion && (
                  <span className="pill" style={{ background: '#dbeafe' }}>
                    当前
                  </span>
                )}
              </td>
              <td>{CHANGE_LABEL[v.changeType]}</td>
              <td>
                {v.message}
                <div className="muted">
                  {statusLabel(v.status)}
                  {v.grayPercent !== null ? ` · ${v.grayPercent}%` : ''} ·{' '}
                  {v.author}
                </div>
                <button
                  className="small"
                  style={{ marginTop: 4 }}
                  onClick={() =>
                    setExpanded(expanded === v.version ? null : v.version)
                  }
                >
                  {expanded === v.version ? '收起快照' : '查看完整快照'}
                </button>
                {expanded === v.version && (
                  <div style={{ marginTop: 6 }}>
                    <div className="muted">默认配置：</div>
                    <KVView data={v.snapshot.defaultConfig} />
                    <div className="muted" style={{ marginTop: 6 }}>
                      规则（{v.snapshot.rules.length}）：
                    </div>
                    {v.snapshot.rules.map((r) => (
                      <div key={r.id} className="trace-box">
                        P{r.priority} {r.name}（{r.enabled ? '启用' : '停用'}，
                        {r.percent}%）→ <KVView data={r.output} />
                      </div>
                    ))}
                  </div>
                )}
              </td>
              <td className="mono">{fmtTime(v.createdAt)}</td>
              <td>{v.stable ? '✅ 稳定生效过' : '📝 草稿'}</td>
              <td>
                {v.stable && v.version !== project.currentVersion && (
                  <button
                    className="danger small"
                    onClick={() => {
                      if (
                        window.confirm(
                          `确认从 v${project.currentVersion} 回滚到 v${v.version}？\n回滚会生成新版本，所有历史版本保留。`,
                        )
                      ) {
                        onAction(
                          () => store.rollback(project.id, v.version),
                          `已回滚：新版本基于历史稳定 v${v.version}，新访问立即使用回滚配置`,
                          '正在执行回滚…',
                        );
                      }
                    }}
                  >
                    回滚到此版本
                  </button>
                )}
                {project.status === 'rolled_back' && v.stable && (
                  <button
                    className="small"
                    style={{ marginLeft: 6 }}
                    onClick={() =>
                      onAction(
                        () => store.reviseFromVersion(project.id, v.version),
                        `已基于 v${v.version} 新建修订草稿`,
                      )
                    }
                  >
                    基于此版本修订
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>版本对比</h3>
      <div className="row">
        <select
          value={compareA}
          style={{ width: 110 }}
          onChange={(e) => setCompareA(Number(e.target.value))}
        >
          {project.versions.map((v) => (
            <option key={v.version} value={v.version}>
              v{v.version}
            </option>
          ))}
        </select>
        <span>→</span>
        <select
          value={compareB}
          style={{ width: 110 }}
          onChange={(e) => setCompareB(Number(e.target.value))}
        >
          {project.versions.map((v) => (
            <option key={v.version} value={v.version}>
              v{v.version}
            </option>
          ))}
        </select>
      </div>
      {compareA === compareB ? (
        <div className="muted" style={{ marginTop: 8 }}>
          请选择两个不同的版本进行对比。
        </div>
      ) : changes.length === 0 ? (
        <div className="muted" style={{ marginTop: 8 }}>
          两个版本的配置内容完全相同（可能只是发布阶段不同）。
        </div>
      ) : (
        <table style={{ marginTop: 8 }}>
          <thead>
            <tr>
              <th style={{ width: 200 }}>变更项</th>
              <th>v{compareA}（旧）</th>
              <th>v{compareB}（新）</th>
            </tr>
          </thead>
          <tbody>
            {changes.map((c, i) => (
              <tr key={i}>
                <td>{c.path}</td>
                <td className="mono">{c.before}</td>
                <td className="mono">{c.after}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
