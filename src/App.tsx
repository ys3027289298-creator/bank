import { useEffect, useMemo, useState } from 'react';
import type {
  AppData,
  ConfigProject,
  ConfigStatus,
  Rule,
  RuleConfig,
  TestUser
} from './core/types';
import {
  ConflictError,
  ValidationError,
  WorkflowError,
  createProject,
  emergencyRelease,
  expandGray,
  loadData,
  recordConflictResolution,
  resetData,
  rollback,
  saveData,
  saveDraft,
  startGray,
  startTest,
  releaseFull
} from './core/store';
import { compareConfigs, estimateImpactedUsers, evaluateUser, stageLabel } from './core/engine';
import { createDemoData, demoConfig } from './core/demo';

type Toast = { type: 'success' | 'error' | 'info' | 'warning'; text: string };
type Tab = 'rules' | 'preview' | 'versions' | 'logs' | 'release';

const statusClass: Record<ConfigStatus, string> = {
  draft: 'draft',
  testing: 'testing',
  gray: 'gray',
  full: 'full',
  rolled_back: 'rolled_back'
};

function formatTime(value: string): string {
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function cloneRules(config: RuleConfig): RuleConfig {
  return structuredClone(config);
}

function emptyRule(priority: number): Rule {
  return {
    id: `rule_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name: '',
    priority,
    enabled: true,
    condition: { userIds: [], regions: [], devices: [], tags: [] },
    effect: { enabled: true, value: '', rolloutPercent: 100 }
  };
}

export default function App() {
  const [data, setData] = useState<AppData>(() => {
    const loaded = loadData();
    return loaded.projects.length || loaded.users.length ? loaded : createDemoData();
  });
  const [selectedId, setSelectedId] = useState<string | null>(data.projects[0]?.id ?? null);
  const [tab, setTab] = useState<Tab>('release');
  const [toast, setToast] = useState<Toast | null>(null);
  const [baseRevision, setBaseRevision] = useState(data.revision);
  const [conflict, setConflict] = useState<{ expected: number; actual: number } | null>(null);
  const [editor, setEditor] = useState<RuleConfig | null>(null);
  const [summary, setSummary] = useState('');
  const [previewUserId, setPreviewUserId] = useState(data.users[0]?.userId ?? '');
  const [percent, setPercent] = useState(10);
  const [emergencyReason, setEmergencyReason] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [newProject, setNewProject] = useState({ name: '', description: '', defaultValue: '' });
  const [processing, setProcessing] = useState('');

  const selected = data.projects.find((project) => project.id === selectedId) ?? null;

  useEffect(() => saveData(data), [data]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== 'gray-release-drill-data-v1') return;
      const latest = loadData();
      if (latest.revision !== data.revision) {
        setConflict({ expected: data.revision, actual: latest.revision });
        setToast({ type: 'warning', text: '检测到另一个浏览器窗口已修改同一数据。' });
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [data.revision]);

  const activeVersion = selected?.versions.find((item) => item.version === selected.activeVersionNumber) ?? null;
  const previewUser = data.users.find((user) => user.userId === previewUserId) ?? null;
  const previewResult = selected && previewUser ? evaluateUser(selected, previewUser) : null;

  const impactUsers = useMemo(() => {
    if (!selected || selected.status !== 'gray') return [];
    return estimateImpactedUsers(selected, data.users, percent);
  }, [selected, data.users, percent]);

  function notify(type: Toast['type'], text: string) {
    setToast({ type, text });
  }

  function commit(next: AppData, success: string) {
    setData(structuredClone(next));
    setBaseRevision(next.revision);
    setConflict(null);
    notify('success', success);
  }

  async function runAction(label: string, action: () => AppData, success: string) {
    setProcessing(label);
    await new Promise((resolve) => window.setTimeout(resolve, 250));
    try {
      const next = action();
      commit(next, success);
    } catch (error) {
      handleError(error);
    } finally {
      setProcessing('');
    }
  }

  function handleError(error: unknown) {
    if (error instanceof ConflictError) {
      setConflict({ expected: error.expectedRevision, actual: error.actualRevision });
      notify('error', error.message);
    } else if (error instanceof ValidationError || error instanceof WorkflowError) {
      notify('error', error.message);
    } else {
      notify('error', `操作失败：${String(error)}`);
    }
  }

  function openEditor() {
    if (!activeVersion) return;
    setEditor(cloneRules(selected?.draft ?? activeVersion.config));
    setSummary('');
    setTab('rules');
  }

    function resolveConflict(choice: 'reload' | 'discard' | 'continue') {
    if (!selected || !conflict) return;
    const latest = loadData();
    const withLog = recordConflictResolution(latest, selected.id, conflict.expected, choice);
    setData(structuredClone(withLog));
    setBaseRevision(withLog.revision);
    if (choice === 'continue' && activeVersion) {
      const latestProject = withLog.projects.find((item) => item.id === selected.id);
      const latestActive = latestProject?.versions.find((item) => item.version === latestProject.activeVersionNumber);
      setEditor(cloneRules(latestActive?.config ?? activeVersion.config));
      setSummary('');
      setTab('rules');
    }
    if (choice === 'discard') setEditor(null);
    setConflict(null);
    notify('success', choice === 'reload' ? '已重新读取最新数据。' : '冲突已按所选方式处理。');
  }

  function simulateOtherWindow() {
    if (!selected) return;
    const latest = loadData();
    const target = latest.projects.find((item) => item.id === selected.id);
    if (!target || !activeVersion) return;
    const changed = cloneRules(activeVersion.config);
    changed.defaultValue = `${changed.defaultValue}（另一窗口于 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })} 修订）`;
    try {
      saveDraft(latest, target.id, changed, '模拟另一个窗口修改默认值', latest.revision);
      saveData(latest);
      setData(structuredClone(latest));
      setConflict({ expected: baseRevision, actual: latest.revision });
      notify('warning', '模拟窗口已提交新版本，当前旧表单现在提交会发生冲突。');
    } catch (error) {
      handleError(error);
    }
  }

  function resetDemo() {
    const demo = createDemoData();
    saveData(demo);
    setData(demo);
    setSelectedId(demo.projects[0].id);
    setBaseRevision(demo.revision);
    setEditor(null);
    setConflict(null);
    setPreviewUserId(demo.users[0].userId);
    notify('success', '演示数据已清空并重新生成。');
  }

  return (
    <div className="app">
      {toast && <div className={`toast ${toast.type}`}>{toast.text}</div>}
      <header className="hero">
        <h1>灰度配置发布与回滚演练</h1>
        <p>真实执行规则匹配、稳定百分比分桶、版本快照、阶段流转、紧急发布和历史回滚；数据持久化在浏览器 localStorage。</p>
        <div className="hero-actions">
          <button onClick={() => setShowCreate(true)}>创建配置项目</button>
          <button className="ghost" onClick={openEditor} disabled={!selected}>编辑当前配置规则</button>
          <button className="ghost" onClick={simulateOtherWindow} disabled={!selected}>模拟另一个窗口修改</button>
          <button className="ghost" onClick={resetDemo}>清空并重新开始演示</button>
        </div>
      </header>

      {conflict && (
        <div className="conflict">
          <h3>检测到版本冲突</h3>
          <p>当前表单基于第 {conflict.expected} 次数据修订，最新数据已经是第 {conflict.actual} 次修订。为避免静默覆盖，本次提交已被拒绝。</p>
          <div className="inline">
            <button onClick={() => resolveConflict('reload')}>重新读取</button>
            <button className="secondary" onClick={() => resolveConflict('discard')}>放弃修改</button>
            <button className="ghost" onClick={() => resolveConflict('continue')}>基于最新版本继续修改</button>
          </div>
        </div>
      )}

      {showCreate && (
        <CreateProject
          value={newProject}
          onChange={setNewProject}
          onCancel={() => setShowCreate(false)}
          onCreate={() => {
            try {
              const next = createProject(structuredClone(data), newProject, baseRevision);
              commit(next, '配置项目已创建。');
              setSelectedId(next.projects[0].id);
              setShowCreate(false);
              setNewProject({ name: '', description: '', defaultValue: '' });
            } catch (error) {
              handleError(error);
            }
          }}
        />
      )}

      <div className="layout">
        <aside>
          <ProjectList
            projects={data.projects}
            selectedId={selectedId}
            onSelect={(id) => {
              setSelectedId(id);
              setEditor(null);
            }}
          />
          <div className="panel">
            <h3>演示用户</h3>
            {data.users.map((user) => (
              <div className="log" key={user.userId}>
                <strong>{user.name}</strong>
                <div className="meta">{user.userId} · {user.region} · {user.device} · {user.tags.join('/')}</div>
              </div>
            ))}
          </div>
        </aside>

        <main>
          {!selected ? (
            <div className="panel"><h2>请创建或选择一个配置项目</h2></div>
          ) : (
            <>
              <ProjectHeader project={selected} activeVersion={activeVersion?.version ?? 0} />
              <div className="tabs">
                {([
                  ['release', '发布流程'],
                  ['rules', '规则编辑'],
                  ['preview', '结果预览'],
                  ['versions', '版本记录'],
                  ['logs', '操作记录']
                ] as Array<[Tab, string]>).map(([key, label]) => (
                  <button key={key} className={tab === key ? 'active' : 'ghost'} onClick={() => setTab(key)}>{label}</button>
                ))}
              </div>

              {tab === 'release' && (
                <ReleasePanel
                  project={selected}
                  users={data.users}
                  percent={percent}
                  setPercent={setPercent}
                  impactUsers={impactUsers}
                  emergencyReason={emergencyReason}
                  setEmergencyReason={setEmergencyReason}
                  processing={processing}
                  onTest={() => runAction('进入测试中', () => startTest(structuredClone(data), selected.id, baseRevision), '已进入测试阶段。')}
                  onGray={() => runAction('发布灰度', () => startGray(structuredClone(data), selected.id, percent, baseRevision), `已按 ${percent}% 灰度发布。`)}
                  onExpand={() => runAction('扩大灰度', () => expandGray(structuredClone(data), selected.id, percent, baseRevision), `灰度范围已扩大到 ${percent}%。`)}
                  onFull={() => runAction('全部发布', () => releaseFull(structuredClone(data), selected.id, baseRevision), '已全部发布。')}
                  onEmergency={() => runAction('紧急发布', () => emergencyRelease(structuredClone(data), selected.id, emergencyReason, baseRevision), '紧急发布已完成，原因已记录。')}
                  onRollback={(version) => runAction('执行回滚', () => rollback(structuredClone(data), selected.id, version, baseRevision), `已回滚到 v${version} 的内容，并生成新版本。`)}
                />
              )}

              {tab === 'rules' && (
                <RuleEditorPanel
                  project={selected}
                  editor={editor}
                  setEditor={setEditor}
                  summary={summary}
                  setSummary={setSummary}
                  processing={processing}
                  onStart={() => activeVersion && setEditor(cloneRules(selected.draft ?? activeVersion.config))}
                  onSave={() => {
                    if (!editor) return;
                    runAction('保存规则', () => saveDraft(structuredClone(data), selected.id, editor, summary, baseRevision), '规则已保存为新的草稿版本，线上当前版本未改变。');
                  }}
                />
              )}

              {tab === 'preview' && (
                <PreviewPanel
                  users={data.users}
                  userId={previewUserId}
                  setUserId={setPreviewUserId}
                  result={previewResult}
                />
              )}

              {tab === 'versions' && <VersionsPanel project={selected} />}
              {tab === 'logs' && <LogsPanel project={selected} logs={data.logs} />}
            </>
          )}
        </main>
      </div>
    </div>
  );
}

function ProjectList({ projects, selectedId, onSelect }: {
  projects: ConfigProject[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="panel">
      <h2>配置列表</h2>
      {projects.length === 0 && <p className="muted">暂无配置。</p>}
      {projects.map((project) => (
        <div
          key={project.id}
          className={`project-card ${project.id === selectedId ? 'active' : ''}`}
          onClick={() => onSelect(project.id)}
        >
          <h3>{project.name}</h3>
          <p className="meta">{project.description}</p>
          <span className={`badge ${statusClass[project.status]}`}>{stageLabel(project.status)}</span>
        </div>
      ))}
    </div>
  );
}

function CreateProject({ value, onChange, onCreate, onCancel }: {
  value: { name: string; description: string; defaultValue: string };
  onChange: (value: { name: string; description: string; defaultValue: string }) => void;
  onCreate: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="panel">
      <h2>创建配置项目</h2>
      <div className="grid">
        <div className="field">
          <label>名称</label>
          <input value={value.name} onChange={(event) => onChange({ ...value, name: event.target.value })} placeholder="例如：搜索功能新版" />
        </div>
        <div className="field">
          <label>默认配置值</label>
          <input value={value.defaultValue} onChange={(event) => onChange({ ...value, defaultValue: event.target.value })} placeholder="无规则命中时返回，例如：旧版搜索" />
        </div>
      </div>
      <div className="field">
        <label>说明</label>
        <textarea value={value.description} onChange={(event) => onChange({ ...value, description: event.target.value })} />
      </div>
      <div className="inline">
        <button onClick={onCreate}>创建</button>
        <button className="secondary" onClick={onCancel}>取消</button>
      </div>
    </div>
  );
}

function ProjectHeader({ project, activeVersion }: { project: ConfigProject; activeVersion: number }) {
  const previous = project.previousVersionNumber ? `v${project.previousVersionNumber}` : '无';
  return (
    <div className="panel">
      <div className="inline" style={{ justifyContent: 'space-between' }}>
        <div>
          <h2 style={{ marginBottom: 4 }}>{project.name} <span className={`badge ${statusClass[project.status]}`}>{stageLabel(project.status)}</span></h2>
          <div className="meta">创建：{formatTime(project.createdAt)} · 最近修改：{formatTime(project.updatedAt)}</div>
        </div>
        <div>
          <span className="pill">当前线上 v{activeVersion}</span>
          <span className="pill">上一版本 {previous}</span>
          <span className="pill">数据修订 #{project.revision}</span>
        </div>
      </div>
      <p>{project.description}</p>
    </div>
  );
}

function ReleasePanel(props: {
  project: ConfigProject;
  users: TestUser[];
  percent: number;
  setPercent: (value: number) => void;
  impactUsers: TestUser[];
  emergencyReason: string;
  setEmergencyReason: (value: string) => void;
  processing: string;
  onTest: () => void;
  onGray: () => void;
  onExpand: () => void;
  onFull: () => void;
  onEmergency: () => void;
  onRollback: (version: number) => void;
}) {
  const { project } = props;
  const current = project.versions.find((item) => item.version === project.activeVersionNumber);
  const stableVersions = project.versions.filter((version) => version.stable && version.version !== project.activeVersionNumber);
  return (
    <>
      <div className="panel">
        <h2>发布阶段控制</h2>
        <p className="muted">必要路径：草稿 → 测试中 → 灰度发布 → 全部发布。每次推进都会生成或更新不可删除的版本记录。</p>
        <div className="grid3">
          <button disabled={!['draft', 'rolled_back'].includes(project.status) || Boolean(props.processing)} onClick={props.onTest}>1. 发布到测试</button>
          <button disabled={project.status !== 'testing' || Boolean(props.processing)} onClick={props.onGray}>2. 开始 {props.percent}% 灰度</button>
          <button disabled={project.status !== 'gray' || Boolean(props.processing)} onClick={props.onExpand}>扩大到 {props.percent}%</button>
          <button disabled={project.status !== 'gray' || Boolean(props.processing)} onClick={props.onFull}>4. 全部发布</button>
        </div>
        <div className="field" style={{ marginTop: 12 }}>
          <label>灰度开放比例（1-99%）</label>
          <input type="number" min={1} max={99} value={props.percent} onChange={(event) => props.setPercent(Number(event.target.value))} />
        </div>
        {project.status === 'gray' && (
          <div className="result-box">
            <strong>即将影响 {props.impactUsers.length}/{props.users.length} 名演示用户：</strong>
            <div>{props.impactUsers.map((user) => `${user.name}(${user.userId})`).join('、') || '当前比例下没有用户落入新配置桶'}</div>
          </div>
        )}
        {props.processing && <p>处理中：{props.processing}……</p>}
      </div>

      <div className="panel">
        <h3>紧急发布</h3>
        <p className="muted">紧急发布将明确跳过测试和灰度，但必须填写原因，原因与操作时间会永久写入版本和操作记录。</p>
        <textarea value={props.emergencyReason} onChange={(event) => props.setEmergencyReason(event.target.value)} placeholder="说明为什么必须跳过必要阶段" />
        <button className="danger" style={{ marginTop: 8 }} disabled={Boolean(props.processing)} onClick={props.onEmergency}>紧急发布当前草稿到全部用户</button>
      </div>

      <div className="panel">
        <h3>回滚到稳定历史版本</h3>
        <p className="muted">当前版本：v{project.activeVersionNumber}；上一版本：{project.previousVersionNumber ? `v${project.previousVersionNumber}` : '无'}。回滚会基于历史内容生成新版本，不删除任何历史。</p>
        {stableVersions.length === 0 && <p>暂无可回滚的稳定历史版本。</p>}
        {stableVersions.map((version) => (
          <div className="version inline" key={version.version} style={{ justifyContent: 'space-between' }}>
            <div>
              <strong>v{version.version}</strong> <span className="pill">{stageLabel(version.stage)}</span>
              <div className="meta">{version.changeSummary} · {formatTime(version.createdAt)}</div>
            </div>
            <button className="danger" disabled={Boolean(props.processing)} onClick={() => props.onRollback(version.version)}>回滚到此版本</button>
          </div>
        ))}
      </div>
      {current && (
        <div className="panel">
          <h3>当前版本读取的配置</h3>
          <pre>{JSON.stringify({ stage: current.stage, rolloutPercent: current.rolloutPercent, defaultValue: current.config.defaultValue, rules: current.config.rules }, null, 2)}</pre>
        </div>
      )}
    </>
  );
}

function RuleEditorPanel({ project, editor, setEditor, summary, setSummary, processing, onStart, onSave }: {
  project: ConfigProject;
  editor: RuleConfig | null;
  setEditor: (config: RuleConfig | null) => void;
  summary: string;
  setSummary: (value: string) => void;
  processing: string;
  onStart: () => void;
  onSave: () => void;
}) {
  if (!editor) {
    const active = project.versions.find((item) => item.version === project.activeVersionNumber)!;
    return (
      <div className="panel">
        <h2>规则编辑</h2>
        <p>当前线上版本为 v{active.version}。开始编辑后先保存为草稿，不会立即影响访问结果。</p>
        {project.draft && <p className="meta">当前存在尚未发布的草稿。</p>}
        <button onClick={onStart}>开始编辑规则</button>
      </div>
    );
  }

  function updateRule(ruleId: string, updater: (rule: Rule) => Rule) {
    setEditor({ ...editor!, rules: editor!.rules.map((rule) => rule.id === ruleId ? updater(rule) : rule) });
  }

  function csvToList(value: string): string[] {
    return value.split(/[,，\s]+/).map((item) => item.trim()).filter(Boolean);
  }

  return (
    <div className="panel">
      <h2>编辑规则与生效条件</h2>
      <div className="field">
        <label>无规则命中时的默认配置值</label>
        <input value={editor.defaultValue} onChange={(event) => setEditor({ ...editor, defaultValue: event.target.value })} />
      </div>
      {editor.rules.map((rule) => (
        <div className="rule" key={rule.id}>
          <div className="rule-head">
            <input aria-label="优先级" type="number" value={rule.priority} onChange={(event) => updateRule(rule.id, (item) => ({ ...item, priority: Number(event.target.value) }))} />
            <input aria-label="规则名称" value={rule.name} onChange={(event) => updateRule(rule.id, (item) => ({ ...item, name: event.target.value }))} />
            <label className="small inline"><input type="checkbox" style={{ width: 'auto' }} checked={rule.enabled} onChange={(event) => updateRule(rule.id, (item) => ({ ...item, enabled: event.target.checked }))} />启用</label>
            <button className="danger" onClick={() => setEditor({ ...editor, rules: editor.rules.filter((item) => item.id !== rule.id) })}>删除</button>
          </div>
          <div className="grid">
            <div className="field"><label>用户编号（逗号分隔）</label><input value={rule.condition.userIds.join(',')} onChange={(event) => updateRule(rule.id, (item) => ({ ...item, condition: { ...item.condition, userIds: csvToList(event.target.value) } }))} /></div>
            <div className="field"><label>地区</label><input value={rule.condition.regions.join(',')} onChange={(event) => updateRule(rule.id, (item) => ({ ...item, condition: { ...item.condition, regions: csvToList(event.target.value) } }))} /></div>
            <div className="field"><label>设备类型</label>
              <select value={rule.condition.devices[0] ?? ''} onChange={(event) => updateRule(rule.id, (item) => ({ ...item, condition: { ...item.condition, devices: event.target.value ? [event.target.value as Rule['condition']['devices'][number]] : [] } }))}>
                <option value="">不限</option><option value="ios">ios</option><option value="android">android</option><option value="web">web</option>
              </select>
            </div>
            <div className="field"><label>用户标签</label><input value={rule.condition.tags.join(',')} onChange={(event) => updateRule(rule.id, (item) => ({ ...item, condition: { ...item.condition, tags: csvToList(event.target.value) } }))} /></div>
            <div className="field"><label>命中后的配置值</label><input value={rule.effect.value} onChange={(event) => updateRule(rule.id, (item) => ({ ...item, effect: { ...item.effect, value: event.target.value } }))} /></div>
            <div className="field"><label>规则自身开放比例 0-100%</label><input type="number" min={0} max={100} value={rule.effect.rolloutPercent} onChange={(event) => updateRule(rule.id, (item) => ({ ...item, effect: { ...item.effect, rolloutPercent: Number(event.target.value) } }))} /></div>
          </div>
        </div>
      ))}
      <button className="ghost" onClick={() => setEditor({ ...editor, rules: [...editor.rules, emptyRule(editor.rules.length + 1)] })}>新增规则</button>
      <div className="field" style={{ marginTop: 12 }}>
        <label>本次修改说明</label>
        <input value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="例如：提高上海 VIP 规则优先级，调整 iOS 灰度比例" />
      </div>
      <div className="inline">
        <button disabled={Boolean(processing)} onClick={onSave}>{processing || '保存为新版本草稿'}</button>
        <button className="secondary" onClick={() => setEditor(null)}>取消编辑</button>
      </div>
    </div>
  );
}

function PreviewPanel({ users, userId, setUserId, result }: {
  users: TestUser[];
  userId: string;
  setUserId: (id: string) => void;
  result: ReturnType<typeof evaluateUser> | null;
}) {
  const user = users.find((item) => item.userId === userId);
  return (
    <div className="panel">
      <h2>访问结果实时预览</h2>
      <div className="field">
        <label>选择测试用户</label>
        <select value={userId} onChange={(event) => setUserId(event.target.value)}>
          {users.map((item) => <option key={item.userId} value={item.userId}>{item.name} / {item.userId}</option>)}
        </select>
      </div>
      {user && <p className="meta">输入信息：{user.region} · {user.device} · 标签：{user.tags.join('、') || '无'}</p>}
      {result && (
        <>
          <div className={`result-box ${result.default ? 'default' : ''}`}>
            <h3>{result.default ? '返回默认配置' : `命中规则：${result.matchedRule?.name}`}</h3>
            <p><strong>最终配置值：</strong>{result.value}</p>
            <p><strong>读取版本：</strong>v{result.version}（{stageLabel(result.stage)}）{result.bucket !== null && ` · 稳定分桶 ${result.bucket}`}</p>
          </div>
          <h3>判断过程</h3>
          <div className="steps">
            {result.steps.map((step, index) => (
              <div className={`step ${step.passed ? 'ok' : 'fail'}`} key={index}>{step.passed ? '✓' : '×'} {step.detail}</div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function VersionsPanel({ project }: { project: ConfigProject }) {
  const versions = [...project.versions].sort((a, b) => b.version - a.version);
  return (
    <div className="panel">
      <h2>版本记录与差异比较</h2>
      <p className="muted">选择任意两个版本查看差异；回滚不会删除这里的历史版本。</p>
      <VersionDiff versions={versions} />
      {versions.map((version) => (
        <div className="version" key={version.version}>
          <strong>v{version.version}</strong> <span className="pill">{stageLabel(version.stage)}</span>
          {version.version === project.activeVersionNumber && <span className="badge full">当前生效</span>}
          {version.rollbackFromVersion && <span className="badge rolled_back">回自在先 v{version.rollbackFromVersion}</span>}
          <p>{version.changeSummary}</p>
          <div className="meta">{formatTime(version.createdAt)} · {version.createdBy} · 范围 {version.rolloutPercent}% · {version.stable ? '稳定版本' : '草稿版本'}</div>
          {version.emergencyReason && <div className="meta">紧急原因：{version.emergencyReason}</div>}
        </div>
      ))}
    </div>
  );
}

function VersionDiff({ versions }: { versions: ConfigProject['versions'] }) {
  const [left, setLeft] = useState(versions[0]?.version);
  const [right, setRight] = useState(versions[1]?.version ?? versions[0]?.version);
  const before = versions.find((item) => item.version === left);
  const after = versions.find((item) => item.version === right);
  const diffs = before && after ? compareConfigs(before.config, after.config) : [];
  return (
    <div className="rule">
      <div className="grid3">
        <select value={left} onChange={(event) => setLeft(Number(event.target.value))}>{versions.map((v) => <option key={v.version} value={v.version}>v{v.version}</option>)}</select>
        <select value={right} onChange={(event) => setRight(Number(event.target.value))}>{versions.map((v) => <option key={v.version} value={v.version}>v{v.version}</option>)}</select>
        <div>{diffs.length === 0 ? '两个版本规则配置没有差异' : `${diffs.length} 处差异`}</div>
      </div>
      {diffs.map((diff, index) => <div className="log" key={index}><strong>{diff.path}</strong><div className="meta">v{left}: {diff.before} → v{right}: {diff.after}</div></div>)}
    </div>
  );
}

function LogsPanel({ project, logs }: { project: ConfigProject; logs: AppData['logs'] }) {
  const projectLogs = logs.filter((log) => log.configId === project.id);
  return (
    <div className="panel">
      <h2>{project.name} 的完整操作记录</h2>
      <p className="muted">记录不会因回滚而删除，共 {projectLogs.length} 条。</p>
      {projectLogs.map((log) => (
        <div className="log" key={log.id}>
          <span className={`badge ${log.result === 'success' ? 'full' : log.result === 'conflict' ? 'rolled_back' : 'gray'}`}>{log.result}</span>
          <strong> {log.type}</strong>
          <div>{log.detail}</div>
          <div className="meta">{formatTime(log.time)} · 版本 {log.version ? `v${log.version}` : '-'} {log.previousVersion ? `· 上一版本 v${log.previousVersion}` : ''}</div>
        </div>
      ))}
    </div>
  );
}
