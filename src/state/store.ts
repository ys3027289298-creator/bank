import type {
  AuditLog,
  ChangeType,
  ConfigProject,
  ConfigSnapshot,
  ConfigStatus,
  DemoUser,
  StoreData,
  Version,
} from '../engine/types';
import { demoData } from './demoData';

const STORAGE_KEY = 'gray-release-lab-v1';

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

export interface EditOutcome {
  conflict: boolean;
  latestVersion?: number;
  result: ActionResult;
}

export function emptyData(): StoreData {
  return { projects: [], users: [], logs: [], seq: 0 };
}

export function statusLabel(status: ConfigStatus): string {
  const map: Record<ConfigStatus, string> = {
    draft: '草稿',
    testing: '测试中',
    gray: '灰度发布',
    full: '全部发布',
    rolled_back: '已回滚',
  };
  return map[status];
}

export function validateSnapshot(snapshot: ConfigSnapshot): ActionResult {
  if (!snapshot.name.trim()) return { ok: false, error: '配置名称不能为空' };
  if (Object.keys(snapshot.defaultConfig).length === 0)
    return { ok: false, error: '默认配置至少需要一个键值对' };
  for (const rule of snapshot.rules) {
    if (!rule.name.trim()) return { ok: false, error: '存在未命名的规则' };
    if (rule.percent < 0 || rule.percent > 100)
      return { ok: false, error: `规则「${rule.name}」比例必须在 0-100 之间` };
    if (Object.keys(rule.output).length === 0)
      return { ok: false, error: `规则「${rule.name}」至少需要一个下发配置项` };
  }
  const priorities = snapshot.rules.map((r) => r.priority);
  if (new Set(priorities).size !== priorities.length)
    return { ok: false, error: '规则优先级不能重复' };
  return { ok: true };
}

export class Store {
  private data: StoreData;

  constructor(initial?: StoreData) {
    this.data = initial ?? structuredClone(emptyData());
  }

  static load(): Store {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as StoreData;
        if (parsed && Array.isArray(parsed.projects)) return new Store(parsed);
      }
    } catch {
      /* 数据损坏则回退演示数据 */
    }
    return new Store(structuredClone(demoData));
  }

  save(): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
  }

  reset(): void {
    this.data = structuredClone(demoData);
    this.save();
  }

  wipe(): void {
    this.data = emptyData();
    this.save();
  }

  getAll(): StoreData {
    return this.data;
  }

  getProject(id: string): ConfigProject | undefined {
    return this.data.projects.find((p) => p.id === id);
  }

  getUsers(): DemoUser[] {
    return this.data.users;
  }

  getLogs(configId?: string): AuditLog[] {
    const logs = configId
      ? this.data.logs.filter((l) => l.configId === configId)
      : this.data.logs;
    return [...logs].sort((a, b) => (a.time < b.time ? 1 : -1));
  }

  getVersion(projectId: string, versionNo: number): Version | undefined {
    return this.getProject(projectId)?.versions.find(
      (v) => v.version === versionNo,
    );
  }

  private nextId(prefix: string): string {
    this.data.seq += 1;
    return `${prefix}_${this.data.seq}_${Date.now().toString(36)}`;
  }

  private now(): string {
    return new Date().toISOString();
  }

  private log(entry: Omit<AuditLog, 'id' | 'time'>): AuditLog {
    const record: AuditLog = {
      ...entry,
      id: this.nextId('log'),
      time: this.now(),
    };
    this.data.logs.push(record);
    return record;
  }

  createProject(input: {
    name: string;
    description: string;
    defaultConfig: Record<string, string>;
    author: string;
  }): ActionResult<{ id: string }> {
    const name = input.name.trim();
    if (!name) return { ok: false, error: '配置名称不能为空' };
    if (
      this.data.projects.some(
        (p) => p.versions[p.versions.length - 1]?.snapshot.name === name,
      )
    ) {
      return { ok: false, error: `已存在同名配置「${name}」` };
    }
    if (Object.keys(input.defaultConfig).length === 0)
      return { ok: false, error: '默认配置至少需要一个键值对' };

    const id = this.nextId('cfg');
    const time = this.now();
    const snapshot: ConfigSnapshot = {
      name,
      description: input.description.trim(),
      defaultConfig: input.defaultConfig,
      rules: [],
    };
    this.data.projects.push({
      id,
      status: 'draft',
      currentVersion: 1,
      grayPercent: 0,
      versions: [
        {
          version: 1,
          createdAt: time,
          author: input.author || 'anonymous',
          changeType: 'create',
          message: '创建配置',
          snapshot,
          grayPercent: null,
          stable: false,
          status: 'draft',
        },
      ],
      createdAt: time,
      updatedAt: time,
    });
    this.log({
      action: 'create',
      configId: id,
      configName: name,
      version: 1,
      result: 'success',
      detail: '创建配置项目，生成 v1 草稿',
    });
    this.save();
    return { ok: true, data: { id } };
  }

  /**
   * 乐观锁编辑：baseVersion 必须等于当前版本，否则判定为并发冲突并拒绝覆盖。
   */
  editConfig(input: {
    projectId: string;
    baseVersion: number;
    snapshot: ConfigSnapshot;
    author: string;
    message: string;
  }): EditOutcome {
    const project = this.getProject(input.projectId);
    if (!project)
      return { conflict: false, result: { ok: false, error: '配置不存在' } };
    if (project.status === 'rolled_back') {
      return {
        conflict: false,
        result: {
          ok: false,
          error: '配置已回滚，请在版本记录中基于历史稳定版本「新建修订」',
        },
      };
    }
    const name = project.versions[project.versions.length - 1].snapshot.name;
    if (input.baseVersion !== project.currentVersion) {
      this.log({
        action: 'conflict_blocked',
        configId: project.id,
        configName: name,
        version: input.baseVersion,
        result: 'blocked',
        detail: `编辑被阻止：页面基于 v${input.baseVersion}，最新版本为 v${project.currentVersion}`,
      });
      this.save();
      return {
        conflict: true,
        latestVersion: project.currentVersion,
        result: {
          ok: false,
          error: `版本冲突：您正在编辑 v${input.baseVersion}，但当前已是 v${project.currentVersion}`,
        },
      };
    }
    const validation = validateSnapshot(input.snapshot);
    if (!validation.ok) return { conflict: false, result: validation };

    const newVersionNo = project.currentVersion + 1;
    const time = this.now();
    project.versions.push({
      version: newVersionNo,
      createdAt: time,
      author: input.author || 'anonymous',
      changeType: 'edit',
      message: input.message || '修改配置/规则',
      snapshot: structuredClone(input.snapshot),
      grayPercent: project.status === 'gray' ? project.grayPercent : null,
      stable: project.status !== 'draft',
      status: project.status,
    });
    project.currentVersion = newVersionNo;
    project.updatedAt = time;
    this.log({
      action: 'edit',
      configId: project.id,
      configName: input.snapshot.name,
      version: newVersionNo,
      fromVersion: input.baseVersion,
      result: 'success',
      detail: `基于 v${input.baseVersion} 生成 v${newVersionNo}：${input.message}`,
    });
    this.save();
    return { conflict: false, result: { ok: true } };
  }

  /** 冲突后选择「基于最新版本继续」：生成新版本并留下冲突处理记录 */
  forceEditAfterConflict(input: {
    projectId: string;
    snapshot: ConfigSnapshot;
    author: string;
    message: string;
  }): ActionResult {
    const project = this.getProject(input.projectId);
    if (!project) return { ok: false, error: '配置不存在' };
    const validation = validateSnapshot(input.snapshot);
    if (!validation.ok) return validation;
    const base = project.currentVersion;
    const newVersionNo = base + 1;
    const time = this.now();
    project.versions.push({
      version: newVersionNo,
      createdAt: time,
      author: input.author || 'anonymous',
      changeType: 'edit',
      message: input.message + '（冲突后基于最新版本继续修改）',
      snapshot: structuredClone(input.snapshot),
      grayPercent: project.status === 'gray' ? project.grayPercent : null,
      stable: project.status !== 'draft',
      status: project.status,
    });
    project.currentVersion = newVersionNo;
    project.updatedAt = time;
    this.log({
      action: 'conflict_forced',
      configId: project.id,
      configName: input.snapshot.name,
      version: newVersionNo,
      fromVersion: base,
      result: 'info',
      detail: `冲突后用户选择基于最新 v${base} 继续修改，生成 v${newVersionNo}`,
    });
    this.save();
    return { ok: true };
  }

  /** 回滚后基于历史稳定版本重新开始修订（状态进入草稿的新版本） */
  reviseFromVersion(projectId: string, targetVersion: number): ActionResult {
    const project = this.getProject(projectId);
    if (!project) return { ok: false, error: '配置不存在' };
    if (project.status !== 'rolled_back')
      return { ok: false, error: '只有已回滚的配置可以新建修订' };
    const target = project.versions.find((v) => v.version === targetVersion);
    if (!target || !target.stable)
      return { ok: false, error: '只能基于曾经生效的稳定版本新建修订' };
    const newVersionNo = project.currentVersion + 1;
    const time = this.now();
    project.versions.push({
      version: newVersionNo,
      createdAt: time,
      author: 'operator',
      changeType: 'edit',
      message: `回滚后基于 v${targetVersion} 新建修订草稿`,
      snapshot: structuredClone(target.snapshot),
      grayPercent: null,
      stable: false,
      status: 'draft',
    });
    project.currentVersion = newVersionNo;
    project.status = 'draft';
    project.grayPercent = 0;
    project.updatedAt = time;
    this.log({
      action: 'edit',
      configId: project.id,
      configName: target.snapshot.name,
      version: newVersionNo,
      fromVersion: targetVersion,
      result: 'success',
      detail: `回滚后基于 v${targetVersion} 新建修订草稿 v${newVersionNo}`,
    });
    this.save();
    return { ok: true };
  }

  transition(
    projectId: string,
    target: ConfigStatus,
    options: { percent?: number; reason?: string; author?: string } = {},
  ): ActionResult {
    const project = this.getProject(projectId);
    if (!project) return { ok: false, error: '配置不存在' };
    const name =
      project.versions[project.versions.length - 1].snapshot.name;
    const current = project.status;

    if (target === 'testing' && current !== 'draft')
      return {
        ok: false,
        error: `只有草稿可以进入测试（当前：${statusLabel(current)}）`,
      };

    if (target === 'gray') {
      if (current !== 'testing' && current !== 'gray') {
        if (!options.reason?.trim())
          return { ok: false, error: '跳过测试阶段属于紧急发布，必须填写原因' };
      }
      const percent = options.percent;
      if (percent === undefined || percent <= 0 || percent > 100)
        return { ok: false, error: '灰度比例必须在 1-100 之间' };
      if (current === 'gray' && percent <= project.grayPercent)
        return {
          ok: false,
          error: `扩大范围时比例必须大于当前 ${project.grayPercent}%`,
        };
    }

    if (target === 'full' && current !== 'gray') {
      if (!options.reason?.trim())
        return { ok: false, error: '跳过灰度阶段属于紧急发布，必须填写原因' };
    }

    const fromVersion = project.currentVersion;
    let changeType: ChangeType;
    let message: string;
    if (target === 'testing') {
      changeType = 'start_testing';
      message = '开始测试';
    } else if (target === 'gray') {
      changeType = current === 'gray' ? 'expand_gray' : 'start_gray';
      message =
        current === 'gray'
          ? `扩大灰度范围至 ${options.percent}%`
          : `开始灰度发布，比例 ${options.percent}%`;
    } else if (target === 'full') {
      changeType = current === 'gray' ? 'full_release' : 'emergency_release';
      message = current === 'gray' ? '全部发布' : '紧急全量发布';
    } else {
      return { ok: false, error: '不支持的目标状态' };
    }

    project.versions = project.versions.map((v) =>
      v.version === project.currentVersion ? { ...v, stable: true } : v,
    );
    const newVersionNo = project.currentVersion + 1;
    const time = this.now();
    project.versions.push({
      version: newVersionNo,
      createdAt: time,
      author: options.author || 'operator',
      changeType,
      message,
      snapshot: structuredClone(
        project.versions.find((v) => v.version === fromVersion)!.snapshot,
      ),
      grayPercent: target === 'gray' ? options.percent! : null,
      stable: true,
      status: target,
    });
    project.currentVersion = newVersionNo;
    project.status = target;
    if (target === 'gray') project.grayPercent = options.percent!;
    if (target === 'full') project.grayPercent = 100;
    project.updatedAt = time;
    this.log({
      action: changeType,
      configId: project.id,
      configName: name,
      version: newVersionNo,
      fromVersion,
      result: 'success',
      detail:
        message +
        (options.reason?.trim()
          ? `；紧急原因：${options.reason.trim()}`
          : ''),
      reason: options.reason?.trim() || undefined,
    });
    this.save();
    return { ok: true };
  }

  rollback(
    projectId: string,
    targetVersion: number,
    author = 'operator',
  ): ActionResult<{ newVersion: number }> {
    const project = this.getProject(projectId);
    if (!project) return { ok: false, error: '配置不存在' };
    const target = project.versions.find((v) => v.version === targetVersion);
    if (!target) return { ok: false, error: `v${targetVersion} 不存在` };
    if (!target.stable)
      return {
        ok: false,
        error: `v${targetVersion} 从未真正生效（草稿版本），不能回滚到它`,
      };

    const fromVersion = project.currentVersion;
    const newVersionNo = fromVersion + 1;
    const time = this.now();
    project.versions.push({
      version: newVersionNo,
      createdAt: time,
      author,
      changeType: 'rollback',
      message: `回滚到 v${targetVersion}（${target.message}）`,
      snapshot: structuredClone(target.snapshot),
      grayPercent: null,
      stable: true,
      status: 'rolled_back',
    });
    project.currentVersion = newVersionNo;
    project.status = 'rolled_back';
    project.grayPercent = 0;
    project.updatedAt = time;
    this.log({
      action: 'rollback',
      configId: project.id,
      configName: target.snapshot.name,
      version: newVersionNo,
      fromVersion,
      toVersion: targetVersion,
      result: 'success',
      detail: `从 v${fromVersion} 回滚到历史稳定版本 v${targetVersion}，历史版本全部保留`,
    });
    this.save();
    return { ok: true, data: { newVersion: newVersionNo } };
  }
}
