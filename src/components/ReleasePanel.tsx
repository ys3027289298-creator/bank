import { useMemo, useState } from 'react';
import type { ConfigProject, DemoUser } from '../engine/types';
import { previewImpact } from '../engine/rules';
import { statusLabel, type Store, type ActionResult } from '../state/store';

const FLOW: { key: ConfigProject['status']; label: string }[] = [
  { key: 'draft', label: '草稿' },
  { key: 'testing', label: '测试中' },
  { key: 'gray', label: '灰度发布' },
  { key: 'full', label: '全部发布' },
];

export function ReleasePanel({
  project,
  users,
  store,
  onAction,
}: {
  project: ConfigProject;
  users: DemoUser[];
  store: Store;
  onAction: (
    fn: () => ActionResult<any>,
    okText: string,
    pending?: string,
  ) => boolean;
}) {
  const [percent, setPercent] = useState(
    project.status === 'gray' ? Math.min(project.grayPercent + 10, 100) : 10,
  );
  const [reason, setReason] = useState('');

  const current = project.versions.find(
    (v) => v.version === project.currentVersion,
  )!;
  const previous = project.versions.find(
    (v) => v.version === project.currentVersion - 1,
  );

  const impact = useMemo(() => {
    if (project.status !== 'testing' && project.status !== 'gray') return null;
    return previewImpact(project, users, percent);
  }, [project, users, percent]);

  const activeIndex =
    project.status === 'rolled_back'
      ? -1
      : FLOW.findIndex((f) => f.key === project.status);

  return (
    <div>
      <div className="flow">
        {FLOW.map((step, i) => (
          <span key={step.key} className="row" style={{ gap: 6 }}>
            <span
              className={`step ${
                project.status === 'rolled_back'
                  ? 'done'
                  : i === activeIndex
                    ? 'active'
                    : i < activeIndex
                      ? 'done'
                      : ''
              }`}
            >
              {step.label}
            </span>
            {i < FLOW.length - 1 && <span className="arrow">→</span>}
          </span>
        ))}
        {project.status === 'rolled_back' && (
          <>
            <span className="arrow">→</span>
            <span className="step rolled">已回滚</span>
          </>
        )}
      </div>

      <div className="grid grid-2">
        <div className="banner info">
          <div>
            当前版本：<strong>v{project.currentVersion}</strong>（{current.message}
            ，{statusLabel(project.status)}
            {project.status === 'gray' && ` · ${project.grayPercent}%`}）
          </div>
          <div style={{ marginTop: 4 }}>
            上一版本：
            {previous
              ? `v${previous.version}（${previous.message}，${statusLabel(previous.status)}）`
              : '无'}
          </div>
        </div>
        <div className="banner warn">
          每次阶段推进都会生成一个新版本并写入操作记录，不能靠改数字跳步。
        </div>
      </div>

      <div className="grid grid-2">
        <div>
          <h3>阶段操作</h3>
          <div className="row wrap">
            <button
              className="primary"
              disabled={project.status !== 'draft'}
              onClick={() =>
                onAction(
                  () => store.transition(project.id, 'testing'),
                  '已进入测试阶段，生成新版本',
                  '正在发布到测试环境…',
                )
              }
            >
              ① 开始测试
            </button>
            <button
              className="primary"
              disabled={
                project.status !== 'testing' && project.status !== 'gray'
              }
              onClick={() =>
                onAction(
                  () =>
                    store.transition(project.id, 'gray', {
                      percent,
                      reason: reason.trim() || undefined,
                    }),
                  project.status === 'gray'
                    ? `灰度范围已扩大到 ${percent}%`
                    : `已开始 ${percent}% 灰度发布`,
                  '正在灰度放量…',
                )
              }
            >
              {project.status === 'gray'
                ? `③ 扩大到 ${percent}%`
                : '② 开始灰度'}
            </button>
            <input
              type="number"
              min={1}
              max={100}
              value={percent}
              style={{ width: 90 }}
              onChange={(e) => setPercent(Number(e.target.value))}
            />
            <span className="muted">%</span>
            <button
              disabled={project.status !== 'gray'}
              onClick={() =>
                onAction(
                  () => store.transition(project.id, 'full'),
                  '已全部发布（100%）',
                  '正在全量发布…',
                )
              }
            >
              ④ 全部发布
            </button>
          </div>

          <h3>紧急发布（跳过必要阶段）</h3>
          <label className="field">
            <span>紧急原因（必填，会写入审计记录与时间）</span>
            <input
              value={reason}
              placeholder="例如：线上 P0 故障，需要立即全量热修复"
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <div className="row">
            <button
              className="warn"
              disabled={project.status === 'full' || project.status === 'testing'}
              onClick={() =>
                onAction(
                  () =>
                    store.transition(project.id, 'full', {
                      reason: reason.trim() || undefined,
                    }),
                  '紧急全量发布完成，原因已记录',
                  '正在执行紧急发布…',
                )
              }
            >
              紧急全量发布
            </button>
            <button
              className="warn"
              disabled={
                project.status === 'full' ||
                project.status === 'gray' ||
                project.status === 'testing'
              }
              onClick={() =>
                onAction(
                  () =>
                    store.transition(project.id, 'gray', {
                      percent,
                      reason: reason.trim() || undefined,
                    }),
                  '紧急灰度发布完成，原因已记录',
                  '正在执行紧急灰度…',
                )
              }
            >
              紧急灰度（跳过测试）
            </button>
          </div>
        </div>

        <div>
          <h3>
            影响面预测
            {project.status === 'gray' && (
              <span className="muted">
                {' '}
                — 当前 {project.grayPercent}% → 目标 {percent}%
              </span>
            )}
          </h3>
          {!impact && (
            <div className="muted">
              进入测试或灰度阶段后，此处实时计算目标比例下将命中新配置的演示用户。
            </div>
          )}
          {impact && (
            <div>
              <div className="banner info">
                目标 {percent}% 灰度下，{users.length} 名演示用户中预计{' '}
                <strong>{impact.willHit.length}</strong> 人看到新配置，
                <strong>{impact.willDefault.length}</strong> 人仍使用旧配置。
                以下结果由规则引擎按真实桶号实时计算。
              </div>
              <table>
                <thead>
                  <tr>
                    <th>将看到新配置</th>
                    <th>将保持旧配置</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      {impact.willHit.length
                        ? impact.willHit
                            .map((u) => `${u.id} ${u.name.split('（')[0]}`)
                            .join('、')
                        : '（无）'}
                    </td>
                    <td>
                      {impact.willDefault.length
                        ? impact.willDefault
                            .map((u) => `${u.id} ${u.name.split('（')[0]}`)
                            .join('、')
                        : '（无）'}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
