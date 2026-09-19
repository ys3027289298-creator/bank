import type {
  ConfigProject,
  DemoUser,
  EvalResult,
  Rule,
  RuleTrace,
} from './types';
import { bucketOf } from './hash';

function arraysIntersect(a: string[], b: string[]): boolean {
  if (a.length === 0) return true;
  const setB = new Set(b);
  return a.some((x) => setB.has(x));
}

export function ruleMatches(rule: Rule, user: DemoUser): boolean {
  if (!rule.enabled) return false;
  return (
    arraysIntersect(rule.condition.userIds, [user.id]) &&
    arraysIntersect(rule.condition.regions, [user.region]) &&
    arraysIntersect(rule.condition.devices, [user.device]) &&
    arraysIntersect(rule.condition.tags, user.tags)
  );
}

function buildTrace(
  rule: Rule,
  user: DemoUser,
  configId: string,
  gateOpen: boolean,
  grayPercentCap: number | null,
): RuleTrace {
  const c = rule.condition;
  const trace: RuleTrace = {
    ruleId: rule.id,
    ruleName: rule.name,
    priority: rule.priority,
    enabled: rule.enabled,
    conditionTraces: [],
    conditionsMatched: false,
    bucket: null,
    percent: null,
    percentPassed: null,
    hit: false,
  };

  if (!rule.enabled) {
    trace.skipReason = '规则未启用';
    return trace;
  }

  trace.conditionTraces = [
    {
      dimension: '用户编号',
      expected: c.userIds.length ? c.userIds.join('、') : '不限',
      actual: user.id,
      pass: arraysIntersect(c.userIds, [user.id]),
    },
    {
      dimension: '地区',
      expected: c.regions.length ? c.regions.join('、') : '不限',
      actual: user.region,
      pass: arraysIntersect(c.regions, [user.region]),
    },
    {
      dimension: '设备',
      expected: c.devices.length ? c.devices.join('、') : '不限',
      actual: user.device,
      pass: arraysIntersect(c.devices, [user.device]),
    },
    {
      dimension: '用户标签',
      expected: c.tags.length ? c.tags.join('、') : '不限',
      actual: user.tags.length ? user.tags.join('、') : '(无标签)',
      pass: arraysIntersect(c.tags, user.tags),
    },
  ];
  trace.conditionsMatched = trace.conditionTraces.every((t) => t.pass);
  if (!trace.conditionsMatched) {
    trace.skipReason = '条件未全部满足';
    return trace;
  }

  if (!gateOpen) {
    trace.skipReason = '当前状态未开放灰度流量（需测试中/灰度发布/全部发布）';
    return trace;
  }

  // 规则自身比例为 100% 时视为“定向规则”（如白名单/VIP），不受全局灰度上限压缩；
  // 其余按比例放量规则取「规则比例」与「全局灰度上限」的较小值。
  const effectivePercent =
    rule.percent >= 100
      ? 100
      : grayPercentCap === null
        ? rule.percent
        : Math.min(rule.percent, grayPercentCap);
  const bucket = bucketOf(configId, user.id + ':' + rule.id);
  trace.bucket = bucket;
  trace.percent = effectivePercent;
  trace.percentPassed = bucket < effectivePercent;
  if (!trace.percentPassed) {
    trace.skipReason = `用户桶号 ${bucket} 不在前 ${effectivePercent}% 内（0-${effectivePercent - 1} 才命中）`;
  }
  return trace;
}

/**
 * 评估某个用户在配置当前生效版本上的真实结果。
 * 规则按 priority 升序逐条判断；命中第一条条件+比例都通过的规则即停止。
 */
export function evaluate(
  project: ConfigProject,
  user: DemoUser,
): EvalResult {
  const version = project.versions.find(
    (v) => v.version === project.currentVersion,
  );
  if (!version) {
    return {
      variant: 'default',
      output: {},
      matchedRuleId: null,
      matchedRuleName: null,
      traces: [],
      gateReason: '没有可用版本',
    };
  }

  let gateOpen = false;
  let cap: number | null = null;
  let gateReason = '';
  switch (project.status) {
    case 'testing':
      gateOpen = true;
      cap = 100;
      gateReason = '当前为【测试中】：命中条件的测试用户均可见新配置（不按比例放量）。';
      break;
    case 'gray':
      gateOpen = true;
      cap = project.grayPercent;
      gateReason = `当前为【灰度发布】：全局放量上限 ${project.grayPercent}%，规则自身比例与该上限取较小值。`;
      break;
    case 'full':
      gateOpen = true;
      cap = null;
      gateReason = '当前为【全部发布】：所有命中条件的用户均可见新配置。';
      break;
    case 'rolled_back':
      gateOpen = false;
      gateReason = '当前为【已回滚】：新配置全部关闭，所有用户使用默认（旧）配置。';
      break;
    default:
      gateOpen = false;
      gateReason = '当前为【草稿】：尚未发布，所有用户使用默认配置。';
  }

  const sorted = [...version.snapshot.rules].sort(
    (a, b) => a.priority - b.priority,
  );
  const traces = sorted.map((rule) =>
    buildTrace(rule, user, project.id, gateOpen, cap),
  );

  const winner = traces.find((t) => t.conditionsMatched && t.percentPassed === true);
  if (winner) {
    const rule = sorted.find((r) => r.id === winner.ruleId)!;
    winner.hit = true;
    return {
      variant: 'new',
      output: rule.output,
      matchedRuleId: rule.id,
      matchedRuleName: rule.name,
      traces,
      gateReason,
    };
  }

  return {
    variant: 'default',
    output: version.snapshot.defaultConfig,
    matchedRuleId: null,
    matchedRuleName: null,
    traces,
    gateReason,
  };
}

/** 预测在某个灰度比例下，演示用户中会命中新配置的用户，用于扩大范围前影响面提示 */
export function previewImpact(
  project: ConfigProject,
  users: DemoUser[],
  nextPercent: number,
): { willHit: DemoUser[]; willDefault: DemoUser[] } {
  const simulated: ConfigProject = { ...project, status: 'gray', grayPercent: nextPercent };
  const willHit: DemoUser[] = [];
  const willDefault: DemoUser[] = [];
  for (const user of users) {
    const result = evaluate(simulated, user);
    (result.variant === 'new' ? willHit : willDefault).push(user);
  }
  return { willHit, willDefault };
}
