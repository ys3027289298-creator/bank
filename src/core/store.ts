import type {
  AppData,
  ConfigProject,
  ConfigStatus,
  ConfigVersion,
  OperationLog,
  RuleConfig
} from './types';

const STORAGE_KEY = 'gray-release-drill-data-v1';

export function nowText(): string {
  return new Date().toISOString();
}

export function rollback(data: AppData, projectId: string, targetVersion: number, expectedRevision = data.revision): AppData {
  requireRevision(data, expectedRevision);
  const project = getProject(data, projectId);
  const target = project.versions.find((item) => item.version === targetVersion && item.stable);
  if (!target) throw new ValidationError('只能回滚到曾经进入测试、灰度或全部发布阶段的稳定版本。');
  const beforeVersion = project.activeVersionNumber;
  if (targetVersion === beforeVersion) throw new ValidationError('目标版本就是当前生效版本，无需回滚。');

  const restored: ConfigVersion = {
    ...clone(target),
    version: latestVersion(project).version + 1,
    createdAt: nowText(),
    changeSummary: `从 v${beforeVersion} 回滚到 v${target.version} 的配置内容与发布规则`,
    stable: true,
    rollbackFromVersion: beforeVersion
  };
  project.versions.unshift(restored);
  project.previousVersionNumber = beforeVersion;
  project.activeVersionNumber = restored.version;
  project.status = 'rolled_back';
  project.draft = null;
  touch(data, project);
  appendLog(data, {
    type: 'rollback',
    configId: project.id,
    configName: project.name,
    version: restored.version,
    previousVersion: beforeVersion,
    detail: `执行回滚：回滚前线上版本 v${beforeVersion}，目标历史版本 v${target.version}，回滚后生成新版本 v${restored.version}；历史版本全部保留。`,
    result: 'success'
  });
  return data;
}

export function recordConflictResolution(
  data: AppData,
  projectId: string,
  expectedRevision: number,
  choice: 'reload' | 'discard' | 'continue'
): AppData {
  const project = getProject(data, projectId);
  const labels = {
    reload: '重新读取最新版本',
    discard: '放弃本地修改',
    continue: '基于最新版本继续修改'
  };
  const actualRevision = data.revision;
  data.revision += 1;
  appendLog(data, {
    type: 'conflict_resolve',
    configId: project.id,
    configName: project.name,
    version: project.activeVersionNumber,
    detail: `检测到并发修改冲突（旧修订号 ${expectedRevision}，当前修订号 ${actualRevision}），处理方式：${labels[choice]}。系统未静默覆盖任何修改。`,
    result: 'conflict'
  });
  return data;
}

export { appendLog };

export function createId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function clone<T>(value: T): T {
  return structuredClone(value);
}

export class ConflictError extends Error {
  constructor(
    public expectedRevision: number,
    public actualRevision: number
  ) {
    super(`版本已变化：页面基于第 ${expectedRevision} 次修订，但当前数据已经是第 ${actualRevision} 次修订。`);
    this.name = 'ConflictError';
  }
}

export class ValidationError extends Error {}
export class WorkflowError extends Error {}

export function emptyData(): AppData {
  return { projects: [], users: [], logs: [], revision: 0 };
}

export function loadData(): AppData {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return emptyData();
  try {
    const parsed = JSON.parse(raw) as AppData;
    return {
      projects: parsed.projects ?? [],
      users: parsed.users ?? [],
      logs: parsed.logs ?? [],
      revision: parsed.revision ?? 0
    };
  } catch {
    return emptyData();
  }
}

export function saveData(data: AppData): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  window.dispatchEvent(new CustomEvent('gray-data-saved'));
}

export function resetData(): AppData {
  const data = emptyData();
  saveData(data);
  return data;
}

function appendLog(
  data: AppData,
  entry: Omit<OperationLog, 'id' | 'time'>
): OperationLog {
  const record: OperationLog = { id: createId('log'), time: nowText(), ...entry };
  data.logs.unshift(record);
  return record;
}

function requireRevision(data: AppData, expectedRevision: number): void {
  if (data.revision !== expectedRevision) throw new ConflictError(expectedRevision, data.revision);
}

function touch(data: AppData, project: ConfigProject): void {
  project.updatedAt = nowText();
  data.revision += 1;
}

function getProject(data: AppData, id: string): ConfigProject {
  const project = data.projects.find((item) => item.id === id);
  if (!project) throw new ValidationError('未找到指定配置项目。');
  return project;
}

function latestVersion(project: ConfigProject): ConfigVersion {
  return project.versions.reduce((max, item) => (item.version > max.version ? item : max), project.versions[0]);
}

function makeVersion(
  project: ConfigProject,
  config: RuleConfig,
  stage: ConfigStatus,
  summary: string
): ConfigVersion {
  return {
    version: latestVersion(project).version + 1,
    createdAt: nowText(),
    createdBy: '演练用户',
    changeSummary: summary,
    stage,
    rolloutPercent: stage === 'full' ? 100 : 0,
    config: clone(config),
    stable: stage !== 'draft'
  };
}

function validateRuleConfig(config: RuleConfig): void {
  if (!config.defaultValue.trim()) throw new ValidationError('默认配置值不能为空。');
  config.rules.forEach((rule) => {
    if (!rule.name.trim()) throw new ValidationError('存在未命名规则。');
    if (rule.priority < 1) throw new ValidationError(`规则「${rule.name}」优先级必须大于 0。`);
    if (rule.effect.rolloutPercent < 0 || rule.effect.rolloutPercent > 100) {
      throw new ValidationError(`规则「${rule.name}」比例必须在 0 到 100 之间。`);
    }
    if (!rule.effect.value.trim()) throw new ValidationError(`规则「${rule.name}」命中后的配置值不能为空。`);
  });
  const priorities = config.rules.filter((rule) => rule.enabled).map((rule) => rule.priority);
  if (new Set(priorities).size !== priorities.length) {
    throw new ValidationError('启用规则的优先顺序不能重复，数字越小优先级越高。');
  }
}

export function createProject(
  data: AppData,
  input: { name: string; description: string; defaultValue: string },
  expectedRevision = data.revision
): AppData {
  requireRevision(data, expectedRevision);
  const name = input.name.trim();
  const description = input.description.trim();
  const value = input.defaultValue.trim();
  if (!name) throw new ValidationError('配置名称不能为空。');
  if (data.projects.some((project) => project.name === name)) throw new ValidationError('已存在同名配置项目。');
  if (!description) throw new ValidationError('配置说明不能为空。');
  if (!value) throw new ValidationError('默认配置值不能为空，用于无规则匹配时返回。');

  const project: ConfigProject = {
    id: createId('cfg'),
    name,
    description,
    status: 'draft',
    createdAt: nowText(),
    updatedAt: nowText(),
    revision: data.revision,
    draft: null,
    activeVersionNumber: 1,
    previousVersionNumber: null,
    versions: []
  };
  const version: ConfigVersion = {
    version: 1,
    createdAt: nowText(),
    createdBy: '演练用户',
    changeSummary: '创建配置项目和默认值',
    stage: 'draft',
    rolloutPercent: 0,
    config: { rules: [], defaultValue: value },
    stable: false
  };
  project.versions = [version];
  data.projects.unshift(project);
  data.revision += 1;
  appendLog(data, {
    type: 'create',
    configName: project.name,
    configId: project.id,
    version: 1,
    detail: `创建配置项目，默认值为「${value}」。`,
    result: 'success'
  });
  return data;
}

export function saveDraft(
  data: AppData,
  projectId: string,
  draft: RuleConfig,
  summary: string,
  expectedRevision = data.revision
): AppData {
  requireRevision(data, expectedRevision);
  const project = getProject(data, projectId);
  validateRuleConfig(draft);
  const trimmedSummary = summary.trim() || '修改规则配置';
  const version = makeVersion(project, draft, 'draft', trimmedSummary);
  version.stable = false;
  project.draft = clone(draft);
  project.status = 'draft';
  project.versions.unshift(version);
  touch(data, project);
  appendLog(data, {
    type: 'edit',
    configId: project.id,
    configName: project.name,
    version: version.version,
    previousVersion: project.activeVersionNumber,
    detail: `${trimmedSummary}。线上仍保持 v${project.activeVersionNumber}，保存后生成待发布草稿 v${version.version}。`,
    result: 'success'
  });
  return data;
}

function requireDraft(project: ConfigProject): RuleConfig {
  if (project.draft) return project.draft;
  const active = activeVersion(project);
  if (active.stage === 'draft') return active.config;
  throw new WorkflowError('当前没有待发布的规则修改，请先编辑并保存草稿。');
}

function activate(project: ConfigProject, version: ConfigVersion, status: ConfigStatus): void {
  project.previousVersionNumber = project.activeVersionNumber;
  project.activeVersionNumber = version.version;
  project.status = status;
  project.draft = null;
}

function publishDraft(
  project: ConfigProject,
  stage: ConfigStatus,
  percent: number,
  summary: string
): ConfigVersion {
  const draftConfig = requireDraft(project);
  const draft = project.versions.find((item) => item.stage === 'draft');
  if (draft) {
    draft.stage = stage;
    draft.rolloutPercent = percent;
    draft.stable = true;
    draft.changeSummary = summary;
    draft.config = clone(draftConfig);
    activate(project, draft, stage);
    return draft;
  }
  const version = makeVersion(project, draftConfig, stage, summary);
  version.rolloutPercent = percent;
  project.versions.unshift(version);
  activate(project, version, stage);
  return version;
}

function activeVersion(project: ConfigProject): ConfigVersion {
  const version = project.versions.find((item) => item.version === project.activeVersionNumber);
  if (!version) throw new WorkflowError('当前生效版本不存在。');
  return version;
}

export function startTest(data: AppData, projectId: string, expectedRevision = data.revision): AppData {
  requireRevision(data, expectedRevision);
  const project = getProject(data, projectId);
  if (!['draft', 'rolled_back'].includes(project.status)) throw new WorkflowError('只有草稿或已回滚状态可以进入测试阶段。');
  const version = publishDraft(project, 'testing', 0, '进入测试阶段：仅规则明确指定的测试用户可见');
  touch(data, project);
  appendLog(data, {
    type: 'start_test',
    configId: project.id,
    configName: project.name,
    version: version.version,
    previousVersion: project.previousVersionNumber ?? undefined,
    detail: '发布到测试阶段，只对规则条件中明确写出的用户编号生效。',
    result: 'success'
  });
  return data;
}

export function startGray(data: AppData, projectId: string, percent: number, expectedRevision = data.revision): AppData {
  requireRevision(data, expectedRevision);
  const project = getProject(data, projectId);
  if (project.status !== 'testing') throw new WorkflowError('灰度发布前必须先进入测试阶段；如需绕过请使用紧急发布并填写原因。');
  if (!Number.isInteger(percent) || percent < 1 || percent > 99) throw new ValidationError('灰度比例必须是 1 到 99 之间的整数。');
  const version = activeVersion(project);
  version.stage = 'gray';
  version.rolloutPercent = percent;
  version.changeSummary = `进入灰度发布：开放 ${percent}% 用户`;
  project.status = 'gray';
  touch(data, project);
  appendLog(data, { type: 'start_gray', configId: project.id, configName: project.name, version: version.version, detail: `从测试阶段扩大到灰度发布，当前开放 ${percent}%。`, result: 'success' });
  return data;
}

export function expandGray(data: AppData, projectId: string, percent: number, expectedRevision = data.revision): AppData {
  requireRevision(data, expectedRevision);
  const project = getProject(data, projectId);
  if (project.status !== 'gray') throw new WorkflowError('只有灰度发布中的配置可以扩大开放比例。');
  const version = activeVersion(project);
  if (!Number.isInteger(percent) || percent <= version.rolloutPercent || percent > 99) {
    throw new ValidationError(`新比例必须是大于当前 ${version.rolloutPercent}% 且小于 100% 的整数。`);
  }
  const oldPercent = version.rolloutPercent;
  version.rolloutPercent = percent;
  version.changeSummary = `灰度范围从 ${oldPercent}% 扩大到 ${percent}%`;
  touch(data, project);
  appendLog(data, { type: 'expand', configId: project.id, configName: project.name, version: version.version, detail: `灰度开放范围由 ${oldPercent}% 扩大到 ${percent}%。`, result: 'success' });
  return data;
}

export function releaseFull(data: AppData, projectId: string, expectedRevision = data.revision): AppData {
  requireRevision(data, expectedRevision);
  const project = getProject(data, projectId);
  if (project.status !== 'gray') throw new WorkflowError('全部发布前必须先经过灰度发布。');
  const version = activeVersion(project);
  version.stage = 'full';
  version.rolloutPercent = 100;
  version.changeSummary = '全部发布';
  project.status = 'full';
  touch(data, project);
  appendLog(data, { type: 'full_release', configId: project.id, configName: project.name, version: version.version, detail: '灰度验证完成，配置对全部匹配用户发布。', result: 'success' });
  return data;
}

export function emergencyRelease(data: AppData, projectId: string, reason: string, expectedRevision = data.revision): AppData {
  requireRevision(data, expectedRevision);
  const trimmed = reason.trim();
  if (trimmed.length < 5) throw new ValidationError('紧急发布必须填写至少 5 个字的原因。');
  const project = getProject(data, projectId);
  requireDraft(project);
  const version = publishDraft(project, 'full', 100, `紧急发布：${trimmed}`);
  version.emergencyReason = trimmed;
  touch(data, project);
  appendLog(data, {
    type: 'emergency_release',
    configId: project.id,
    configName: project.name,
    version: version.version,
    previousVersion: project.previousVersionNumber ?? undefined,
    detail: `用户明确选择紧急发布，跳过测试和灰度。原因：${trimmed}`,
    result: 'success'
  });
  return data;
}
