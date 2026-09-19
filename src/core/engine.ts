import type {
  ConfigProject,
  ConfigVersion,
  EvaluationResult,
  EvaluationStep,
  Rule,
  RuleConfig,
  TestUser
} from './types';

export function stableHash(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function getUserBucket(configId: string, ruleId: string, userId: string): number {
  return stableHash(`${configId}:${ruleId}:${userId}`) % 100;
}

function includesAny(actual: string[], expected: string[]): boolean {
  if (expected.length === 0) return true;
  return expected.some((value) => actual.includes(value));
}

export function describeCondition(rule: Rule): string {
  const parts: string[] = [];
  parts.push(rule.condition.userIds.length ? `用户编号 ${rule.condition.userIds.join('、')}` : '任意用户编号');
  parts.push(rule.condition.regions.length ? `地区 ${rule.condition.regions.join('、')}` : '任意地区');
  parts.push(rule.condition.devices.length ? `设备 ${rule.condition.devices.join('、')}` : '任意设备');
  parts.push(rule.condition.tags.length ? `标签 ${rule.condition.tags.join('、')}` : '任意标签');
  return parts.join('；');
}

export function matchCondition(rule: Rule, user: TestUser): { passed: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const checks = [
    {
      name: '用户编号',
      passed: includesAny([user.userId], rule.condition.userIds),
      expected: rule.condition.userIds.join('、') || '不限'
    },
    {
      name: '地区',
      passed: includesAny([user.region], rule.condition.regions),
      expected: rule.condition.regions.join('、') || '不限'
    },
    {
      name: '设备类型',
      passed: includesAny([user.device], rule.condition.devices),
      expected: rule.condition.devices.join('、') || '不限'
    },
    {
      name: '用户标签',
      passed: includesAny(user.tags, rule.condition.tags),
      expected: rule.condition.tags.join('、') || '不限'
    }
  ];

  checks.forEach((check) => {
    if (!check.passed) reasons.push(`${check.name}不匹配（要求：${check.expected}）`);
  });
  return { passed: reasons.length === 0, reasons };
}

function sortedRules(config: RuleConfig): Rule[] {
  return [...config.rules]
    .filter((rule) => rule.enabled)
    .sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id));
}

export function getActiveVersion(project: ConfigProject): ConfigVersion {
  const found = project.versions.find((item) => item.version === project.activeVersionNumber);
  if (!found) throw new Error(`配置 ${project.name} 缺少当前版本 v${project.activeVersionNumber}`);
  return found;
}

export function evaluateUser(
  project: ConfigProject,
  user: TestUser,
  now = new Date().toISOString()
): EvaluationResult {
  const active = getActiveVersion(project);
  const steps: EvaluationStep[] = [
    {
      passed: true,
      detail: `当前读取 ${project.name} 的生效版本 v${active.version}，版本阶段为「${stageLabel(active.stage)}」，发布范围 ${active.rolloutPercent}%。`
    }
  ];

  if (active.stage === 'draft') {
    steps.push({ passed: false, detail: '当前版本仍处于草稿阶段，尚未对外发布，因此所有规则均不生效。' });
    return defaultResult(active, steps);
  }

  const rules = sortedRules(active.config);
  if (rules.length === 0) {
    steps.push({ passed: false, detail: '当前版本没有启用的规则，访问请求直接使用默认配置。' });
    return defaultResult(active, steps);
  }

  for (const rule of rules) {
    const match = matchCondition(rule, user);
    if (!match.passed) {
      steps.push({
        ruleId: rule.id,
        ruleName: rule.name,
        passed: false,
        detail: `优先级 ${rule.priority} 规则「${rule.name}」条件未通过：${match.reasons.join('，')}。`
      });
      continue;
    }

    steps.push({
      ruleId: rule.id,
      ruleName: rule.name,
      passed: true,
      detail: `优先级 ${rule.priority} 规则「${rule.name}」条件全部通过（${describeCondition(rule)}）。`
    });

    if (active.stage === 'testing') {
      const explicitlySelected = rule.condition.userIds.includes(user.userId);
      if (!explicitlySelected) {
        steps.push({
          ruleId: rule.id,
          ruleName: rule.name,
          passed: false,
          detail: '测试阶段只允许规则中明确指定用户编号的内部测试用户命中，百分比和宽泛条件不会对外生效。'
        });
        continue;
      }
      steps.push({ passed: true, detail: `用户 ${user.userId} 在测试白名单中，命中规则并获得配置值「${rule.effect.value}」。` });
      return ruleResult(active, rule, null, steps);
    }

    if (active.stage === 'gray') {
      const rulePercent = Math.min(active.rolloutPercent, rule.effect.rolloutPercent);
      const bucket = getUserBucket(project.id, rule.id, user.userId);
      const allowed = bucket < rulePercent;
      steps.push({
        ruleId: rule.id,
        ruleName: rule.name,
        passed: allowed,
        detail: `灰度分桶使用稳定哈希（配置ID+规则ID+用户编号），用户 ${user.userId} 落在第 ${bucket} 桶；当前阈值为 ${rulePercent}%（0-${rulePercent - 1} 桶命中），${allowed ? '本次命中。' : '本次未命中，继续看到默认配置。'}`
      });
      if (allowed) return ruleResult(active, rule, bucket, steps);
      return defaultResult(active, steps);
    }

    steps.push({ passed: true, detail: `全部发布阶段忽略百分比限制，规则「${rule.name}」对该用户生效。` });
    return ruleResult(active, rule, null, steps);
  }

  steps.push({ passed: false, detail: '所有启用规则均未匹配该用户，最终使用默认配置。' });
  return defaultResult(active, steps);
}

function ruleResult(
  version: ConfigVersion,
  rule: Rule,
  bucket: number | null,
  steps: EvaluationStep[]
): EvaluationResult {
  return {
    enabled: rule.effect.enabled,
    value: rule.effect.value,
    matchedRule: rule,
    default: false,
    bucket,
    steps,
    stage: version.stage,
    version: version.version
  };
}

function defaultResult(version: ConfigVersion, steps: EvaluationStep[]): EvaluationResult {
  return {
    enabled: false,
    value: version.config.defaultValue,
    matchedRule: null,
    default: true,
    bucket: null,
    steps,
    stage: version.stage,
    version: version.version
  };
}

export function stageLabel(stage: ConfigVersion['stage']): string {
  return {
    draft: '草稿',
    testing: '测试中',
    gray: '灰度发布',
    full: '全部发布',
    rolled_back: '已回滚'
  }[stage];
}

export interface ConfigDiffEntry {
  path: string;
  before: string;
  after: string;
}

export function compareConfigs(before: RuleConfig, after: RuleConfig): ConfigDiffEntry[] {
  const diffs: ConfigDiffEntry[] = [];
  if (before.defaultValue !== after.defaultValue) {
    diffs.push({ path: '默认配置值', before: before.defaultValue, after: after.defaultValue });
  }

  const beforeRules = new Map(before.rules.map((rule) => [rule.id, rule]));
  const afterRules = new Map(after.rules.map((rule) => [rule.id, rule]));

  before.rules.forEach((rule) => {
    if (!afterRules.has(rule.id)) diffs.push({ path: `规则「${rule.name}」`, before: '存在', after: '已删除' });
  });
  after.rules.forEach((rule) => {
    const old = beforeRules.get(rule.id);
    if (!old) {
      diffs.push({ path: `规则「${rule.name}」`, before: '不存在', after: '已新增' });
      return;
    }
    if (old.name !== rule.name) diffs.push({ path: `规则 ${rule.id} 名称`, before: old.name, after: rule.name });
    if (old.priority !== rule.priority) diffs.push({ path: `规则「${rule.name}」优先级`, before: String(old.priority), after: String(rule.priority) });
    if (old.enabled !== rule.enabled) diffs.push({ path: `规则「${rule.name}」状态`, before: old.enabled ? '启用' : '停用', after: rule.enabled ? '启用' : '停用' });
    if (old.effect.value !== rule.effect.value) diffs.push({ path: `规则「${rule.name}」配置值`, before: old.effect.value, after: rule.effect.value });
    if (old.effect.rolloutPercent !== rule.effect.rolloutPercent) diffs.push({ path: `规则「${rule.name}」规则比例`, before: `${old.effect.rolloutPercent}%`, after: `${rule.effect.rolloutPercent}%` });
    const fields: Array<[keyof Rule['condition'], string]> = [
      ['userIds', '用户编号'],
      ['regions', '地区'],
      ['devices', '设备'],
      ['tags', '标签']
    ];
    fields.forEach(([field, label]) => {
      const left = old.condition[field].join('、');
      const right = rule.condition[field].join('、');
      if (left !== right) diffs.push({ path: `规则「${rule.name}」${label}`, before: left || '不限', after: right || '不限' });
    });
  });
  return diffs;
}

export function estimateImpactedUsers(project: ConfigProject, users: TestUser[], percent: number): TestUser[] {
  const active = getActiveVersion(project);
  if (active.stage !== 'gray') return [];
  return users.filter((user) => {
    const candidate = sortedRules(active.config).find((rule) => matchCondition(rule, user).passed);
    if (!candidate) return false;
    const projected = Math.min(percent, candidate.effect.rolloutPercent);
    return getUserBucket(project.id, candidate.id, user.userId) < projected;
  });
}
