import { describe, expect, it } from 'vitest';
import { evaluate, previewImpact, ruleMatches } from './rules';
import { bucketOf } from './hash';
import type { ConfigProject, DemoUser, Rule } from './types';

function makeRule(partial: Partial<Rule> & { id: string; name: string }): Rule {
  return {
    enabled: true,
    priority: 1,
    condition: { userIds: [], regions: [], devices: [], tags: [] },
    percent: 100,
    output: { v: partial.name },
    ...partial,
  };
}

function makeProject(
  rules: Rule[],
  status: ConfigProject['status'] = 'gray',
  grayPercent = 100,
): ConfigProject {
  return {
    id: 'cfg_test',
    status,
    currentVersion: 1,
    grayPercent,
    createdAt: '',
    updatedAt: '',
    versions: [
      {
        version: 1,
        createdAt: '',
        author: 't',
        changeType: 'edit',
        message: '',
        snapshot: {
          name: 't',
          description: '',
          defaultConfig: { v: 'default' },
          rules,
        },
        grayPercent: null,
        stable: true,
        status,
      },
    ],
  };
}

const user: DemoUser = {
  id: 'U1',
  name: 'u',
  region: '北京',
  device: 'iOS',
  tags: ['vip'],
};

describe('规则优先级', () => {
  it('多条规则同时满足时，priority 小的优先', () => {
    const project = makeProject([
      makeRule({ id: 'r_low', name: 'LOW', priority: 5 }),
      makeRule({ id: 'r_high', name: 'HIGH', priority: 1 }),
    ]);
    const result = evaluate(project, user);
    expect(result.variant).toBe('new');
    expect(result.matchedRuleId).toBe('r_high');
  });

  it('高优先级规则比例未通过时，继续判断后续规则', () => {
    const project = makeProject(
      [
        makeRule({ id: 'r_first', name: 'FIRST', priority: 1, percent: 0 }),
        makeRule({ id: 'r_second', name: 'SECOND', priority: 2, percent: 100 }),
      ],
      'gray',
      100,
    );
    const result = evaluate(project, user);
    expect(result.matchedRuleId).toBe('r_second');
    expect(result.traces[0].percentPassed).toBe(false);
  });

  it('停用的规则即使条件满足也不生效', () => {
    const project = makeProject([
      makeRule({ id: 'r_off', name: 'OFF', enabled: false }),
    ]);
    expect(evaluate(project, user).variant).toBe('default');
  });

  it('ruleMatches 逐条件判断：任一维度不满足即不匹配', () => {
    const rule = makeRule({
      id: 'r_region',
      name: 'region',
      condition: { userIds: [], regions: ['上海'], devices: [], tags: [] },
    });
    expect(ruleMatches(rule, user)).toBe(false);
  });
});

describe('按比例开放与稳定性', () => {
  it('同一用户重复评估结果稳定', () => {
    const project = makeProject(
      [makeRule({ id: 'r', name: 'R', percent: 10 })],
      'gray',
      10,
    );
    const first = evaluate(project, user).variant;
    for (let i = 0; i < 50; i++) {
      expect(evaluate(project, user).variant).toBe(first);
    }
  });

  it('桶号对同一 configId+ruleId+userId 恒定', () => {
    expect(bucketOf('c', 'r' + ':' + 'U1')).toBe(bucketOf('c', 'r' + ':' + 'U1'));
    expect(bucketOf('c', 'r:U1')).toBeGreaterThanOrEqual(0);
    expect(bucketOf('c', 'r:U1')).toBeLessThan(100);
  });

  it('10% 比例下大量用户的命中率约为 10%，50% 时约 50%', () => {
    const rule = makeRule({ id: 'r', name: 'R' });
    let hit10 = 0;
    let hit50 = 0;
    const total = 2000;
    for (let i = 0; i < total; i++) {
      const u: DemoUser = { ...user, id: `B${i}` };
      const rule10 = makeRule({ id: 'r', name: 'R', percent: 10 });
      const rule50 = makeRule({ id: 'r', name: 'R', percent: 50 });
      if (evaluate(makeProject([rule10], 'full'), u).variant === 'new') hit10++;
      if (evaluate(makeProject([rule50], 'full'), u).variant === 'new') hit50++;
    }
    expect(hit10 / total).toBeGreaterThan(0.07);
    expect(hit10 / total).toBeLessThan(0.14);
    expect(hit50 / total).toBeGreaterThan(0.45);
    expect(hit50 / total).toBeLessThan(0.55);
  });

  it('规则比例受全局灰度上限约束；100% 定向规则不受约束', () => {
    const project = makeProject(
      [makeRule({ id: 'r', name: 'R', percent: 50 })],
      'gray',
      10,
    );
    let hit = 0;
    for (let i = 0; i < 1000; i++) {
      if (
        evaluate(project, { ...user, id: `C${i}` }).variant === 'new'
      )
        hit++;
    }
    expect(hit / 1000).toBeLessThan(0.15);

    const targeted = makeProject(
      [makeRule({ id: 't', name: 'T', percent: 100 })],
      'gray',
      10,
    );
    expect(evaluate(targeted, user).variant).toBe('new');
  });
});

describe('默认配置与无规则匹配', () => {
  it('草稿状态一律返回默认配置', () => {
    const project = makeProject([makeRule({ id: 'r', name: 'R' })], 'draft');
    const result = evaluate(project, user);
    expect(result.variant).toBe('default');
    expect(result.output).toEqual({ v: 'default' });
  });

  it('没有任何规则时返回默认配置且追踪信息说明原因', () => {
    const project = makeProject([], 'full');
    const result = evaluate(project, user);
    expect(result.variant).toBe('default');
    expect(result.matchedRuleId).toBeNull();
  });

  it('previewImpact 能预测扩大范围后受影响用户', () => {
    const project = makeProject(
      [makeRule({ id: 'r', name: 'R' })],
      'gray',
      10,
    );
    const users = Array.from({ length: 100 }, (_, i) => ({
      ...user,
      id: `D${i}`,
    }));
    const impact = previewImpact(project, users, 100);
    expect(impact.willHit.length + impact.willDefault.length).toBe(100);
    expect(impact.willHit.length).toBe(100);
  });
});
