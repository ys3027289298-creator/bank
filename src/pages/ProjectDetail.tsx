import { useEffect, useMemo, useState } from 'react';
import type { ConfigProject, ConfigSnapshot, DemoUser } from '../engine/types';
import { RuleEditor } from '../components/RuleEditor';
import { PreviewPanel } from '../components/PreviewPanel';
import { ReleasePanel } from '../components/ReleasePanel';
import { VersionPanel } from '../components/VersionPanel';
import { LogsPanel } from '../components/LogsPanel';
import { ConflictSimulator } from '../components/ConflictSimulator';
import { KVView, Section, StatusBadge, fmtTime } from '../components/ui';
import { type ActionResult, type Store } from '../state/store';

type Tab = 'edit' | 'release' | 'preview' | 'versions' | 'logs' | 'conflict';

const TABS: { key: Tab; label: string }[] = [
  { key: 'edit', label: '规则编辑与实时预览' },
  { key: 'release', label: '发布控制台' },
  { key: 'preview', label: '结果预览' },
  { key: 'versions', label: '版本记录与回滚' },
  { key: 'conflict', label: '双窗口冲突演练' },
  { key: 'logs', label: '操作记录' },
];

export function ProjectDetail({
  store,
  projectId,
  users,
  onBack,
  onAction,
  tick,
}: {
  store: Store;
  projectId: string;
  users: DemoUser[];
  onBack: () => void;
  onAction: (
    fn: () => ActionResult<any>,
    ok: string,
    pending?: string,
  ) => boolean;
  tick: number;
}) {
  const [tab, setTab] = useState<Tab>('edit');
  const [draft, setDraft] = useState<ConfigSnapshot | null>(null);
  const [baseVersion, setBaseVersion] = useState(0);
  const [author, setAuthor] = useState('me');
  const [commitMsg, setCommitMsg] = useState('调整规则');
  const [conflict, setConflict] = useState<string | null>(null);

  const project = store.getProject(projectId);

  useEffect(() => {
    const p = store.getProject(projectId);
    if (p) {
      const cur = p.versions.find((v) => v.version === p.currentVersion)!;
      setDraft(structuredClone(cur.snapshot));
      setBaseVersion(p.currentVersion);
      setConflict(null);
    }
  }, [projectId, tick]);

  const suggestions = useMemo(() => {
    return {
      regions: [...new Set(users.map((u) => u.region))],
      tags: [...new Set(users.flatMap((u) => u.tags))],
      userIds: users.map((u) => u.id),
    };
  }, [users]);

  if (!project || !draft)
    return (
      <div className="container">
        <div className="banner warn">配置不存在或已被清空。</div>
        <button onClick={onBack}>返回列表</button>
      </div>
    );

  const current = project.versions.find(
    (v) => v.version === project.currentVersion,
  )!;
  const dirty = JSON.stringify(draft) !== JSON.stringify(current.snapshot);
  const stale = baseVersion !== project.currentVersion;

  const forceContinue = () => {
    const ok = onAction(
      () =>
        store.forceEditAfterConflict({
          projectId,
          snapshot: draft,
          author,
          message: commitMsg,
        }),
      '已基于最新版本继续修改，生成新版本',
      '正在合并提交…',
    );
    if (ok) setConflict(null);
  };

  const trySave = () => {
    if (project.status === 'rolled_back') {
      onAction(
        () => ({
          ok: false,
          error: '配置已回滚，请先在「版本记录」中新建修订',
        }),
        '',
      );
      return;
    }
    const outcome = store.editConfig({
      projectId,
      baseVersion,
      snapshot: draft,
      author,
      message: commitMsg,
    });
    if (outcome.conflict) {
      onAction(() => ({ ok: false, error: outcome.result.error }), '');
      setConflict(outcome.result.error!);
      return;
    }
    if (outcome.result.ok) {
      onAction(() => ({ ok: true }), '规则已保存为新版本', '正在提交修改…');
      setConflict(null);
    } else {
      onAction(() => ({ ok: false, error: outcome.result.error }), '');
    }
  };

  const reread = () => {
    const p = store.getProject(projectId)!;
    const cur = p.versions.find((v) => v.version === p.currentVersion)!;
    setDraft(structuredClone(cur.snapshot));
    setBaseVersion(p.currentVersion);
    setConflict(null);
  };

  return (
    <div className="container">
      <div className="row" style={{ marginBottom: 12 }}>
        <button onClick={onBack}>← 返回配置列表</button>
        <h2 style={{ margin: 0 }}>{current.snapshot.name}</h2>
        <StatusBadge status={project.status} />
        {project.status === 'gray' && (
          <span className="pill" style={{ background: '#fef3c7' }}>
            当前灰度 {project.grayPercent}%
          </span>
        )}
        <span className="muted">当前 v{project.currentVersion} · 创建于 {fmtTime(project.createdAt)}</span>
      </div>

      <div className="card" style={{ padding: 12 }}>
        <div className="muted">{current.snapshot.description}</div>
        <div style={{ marginTop: 6 }}>
          默认配置：<KVView data={current.snapshot.defaultConfig} />
        </div>
      </div>

      <div className="tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={tab === t.key ? 'active' : ''}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'edit' && (
        <>
          <Section
            title={`规则编辑（本页基于 v${baseVersion}${
              stale ? '，已过期' : ''
            }；修改不会直接改动已发布版本，保存时生成新版本）`}
          >
            <div className="grid grid-2">
              <label className="field">
                <span>配置说明</span>
                <textarea
                  rows={2}
                  value={draft.description}
                  onChange={(e) =>
                    setDraft({ ...draft, description: e.target.value })
                  }
                />
              </label>
              <div className="grid grid-2">
                <label className="field">
                  <span>修改人</span>
                  <input value={author} onChange={(e) => setAuthor(e.target.value)} />
                </label>
                <label className="field">
                  <span>本次修改说明（写入版本记录）</span>
                  <input
                    value={commitMsg}
                    onChange={(e) => setCommitMsg(e.target.value)}
                  />
                </label>
              </div>
            </div>
            <RuleEditor
              snapshot={draft}
              onChange={setDraft}
              regionSuggestions={suggestions.regions}
              tagSuggestions={suggestions.tags}
              userSuggestions={suggestions.userIds}
            />
            <div className="row" style={{ marginTop: 12 }}>
              <button className="primary" onClick={trySave} disabled={!dirty}>
                保存为新版本 v{project.currentVersion + 1}
              </button>
              <button onClick={reread}>重新读取已发布版本</button>
              <span className="muted">
                {dirty
                  ? '有未保存的规则修改，右侧预览已实时反映这些修改'
                  : '没有未保存修改，右侧预览反映已发布版本'}
              </span>
            </div>
            {conflict && (
              <div className="banner error" style={{ marginTop: 12 }}>
                <strong>{conflict}</strong>
                <div className="muted" style={{ color: '#991b1b', marginTop: 4 }}>
                  系统没有覆盖任何人的修改。请选择处理方式：
                </div>
                <div className="row wrap" style={{ marginTop: 6 }}>
                  <button
                    className="small"
                    onClick={() => {
                      reread();
                      onAction(() => ({ ok: true }), '已重新读取最新版本');
                    }}
                  >
                    重新读取（放弃本地修改）
                  </button>
                  <button
                    className="small"
                    onClick={() => {
                      setDraft(null);
                      setConflict(null);
                      reread();
                      onAction(() => ({ ok: true }), '已放弃本地修改');
                    }}
                  >
                    放弃修改
                  </button>
                  <button
                    className="small warn"
                    onClick={forceContinue}
                  >
                    基于最新版本继续修改（保留当前编辑内容并生成新版本）
                  </button>
                </div>
              </div>
            )}
          </Section>
          <Section
            title="实时结果预览（编辑未保存也可立即验证规则变化）"
          >
            <PreviewPanel
              project={project}
              users={users}
              overrideSnapshot={dirty ? draft : undefined}
              overrideNote={
                dirty
                  ? '当前预览使用你尚未保存的草稿规则，保存为新版本后将对真实访问生效。'
                  : undefined
              }
            />
          </Section>
        </>
      )}

      {tab === 'release' && (
        <Section title="发布控制台">
          <ReleasePanel
            project={project}
            users={users}
            store={store}
            onAction={onAction}
          />
        </Section>
      )}

      {tab === 'preview' && (
        <Section title="结果预览（对已发布的当前版本进行真实判断）">
          <PreviewPanel project={project} users={users} />
        </Section>
      )}

      {tab === 'versions' && (
        <Section title="版本记录、版本对比与回滚">
          <VersionPanel project={project} store={store} onAction={onAction} />
        </Section>
      )}

      {tab === 'conflict' && (
        <Section title="双窗口并发修改冲突演练">
          <ConflictSimulator
            project={project}
            store={store}
            onAction={onAction}
          />
        </Section>
      )}

      {tab === 'logs' && (
        <Section title={`操作记录（${store.getLogs(projectId).length} 条，回滚不会删除）`}>
          <LogsPanel logs={store.getLogs(projectId)} />
        </Section>
      )}
    </div>
  );
}
