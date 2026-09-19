import type { ConfigSnapshot, Rule } from './types';

export interface FieldChange {
  path: string;
  before: string;
  after: string;
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '(无)';
  if (typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>);
    if (entries.length === 0) return '(空)';
    return entries.map(([k, val]) => `${k}=${val}`).join('；');
  }
  return String(v);
}

function ruleSummary(rule: Rule): string {
  const c = rule.condition;
  return [
    `P${rule.priority}`,
    rule.enabled ? '启用' : '停用',
    `比例${rule.percent}%`,
    c.userIds.length ? `用户:${c.userIds.join('/')}` : '',
    c.regions.length ? `地区:${c.regions.join('/')}` : '',
    c.devices.length ? `设备:${c.devices.join('/')}` : '',
    c.tags.length ? `标签:${c.tags.join('/')}` : '',
  ]
    .filter(Boolean)
    .join('，');
}

export function diffSnapshots(
  before: ConfigSnapshot,
  after: ConfigSnapshot,
): FieldChange[] {
  const changes: FieldChange[] = [];
  const scalar: { key: string; label: string; value: unknown }[] = [
    { key: 'name', label: '名称', value: after.name },
    { key: 'description', label: '说明', value: after.description },
  ];
  for (const field of scalar) {
    const a = (before as unknown as Record<string, unknown>)[field.key];
    const b = (after as unknown as Record<string, unknown>)[field.key];
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      changes.push({
        path: field.label,
        before: formatValue(a),
        after: formatValue(b),
      });
    }
  }
  if (
    JSON.stringify(before.defaultConfig) !== JSON.stringify(after.defaultConfig)
  ) {
    changes.push({
      path: '默认配置',
      before: formatValue(before.defaultConfig),
      after: formatValue(after.defaultConfig),
    });
  }

  const beforeMap = new Map(before.rules.map((r) => [r.id, r]));
  const afterMap = new Map(after.rules.map((r) => [r.id, r]));
  for (const rule of after.rules) {
    const old = beforeMap.get(rule.id);
    if (!old) {
      changes.push({ path: `规则[新增] ${rule.name}`, before: '(无)', after: ruleSummary(rule) });
    } else if (JSON.stringify(old) !== JSON.stringify(rule)) {
      changes.push({
        path: `规则[修改] ${rule.name}`,
        before: ruleSummary(old),
        after: ruleSummary(rule),
      });
    }
  }
  for (const rule of before.rules) {
    if (!afterMap.has(rule.id)) {
      changes.push({ path: `规则[删除] ${rule.name}`, before: ruleSummary(rule), after: '(无)' });
    }
  }
  return changes;
}
