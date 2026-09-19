import { beforeEach, describe, expect, it } from 'vitest';
import { createDemoData } from './demo';
import { compareConfigs, evaluateUser, getUserBucket } from './engine';
import {
  ConflictError,
  createProject,
  emergencyRelease,
  expandGray,
  recordConflictResolution,
  resetData,
  rollback,
  saveData,
  saveDraft,
  startGray,
  startTest
} from './store';

beforeEach(() => {
  localStorage.clear();
});

function demoProject() {
  return createDemoData().projects[0];
}

describe('规则优先级', () => {
  it('多个条件同时满足时使用优先级数字最小的规则', () => {
    const data = createDemoData();
    const project = data.projects[0];
    startTest(data, project.id, 1);
    const user = data.users.find((item) => item.userId === 'U1002')!;
    const result = evaluateUser(project, user);

    expect(result.matchedRule?.id).toBe('rule-vip-region');
    expect(result.value).toBe('新版支付页面-VIP体验');
    expect(result.steps.some((step) => step.detail.includes('优先级 2'))).toBe(true);
    expect(result.steps.some((step) => step.detail.includes('安卓用户保底规则') && step.detail.includes('条件未通过'))).toBe(false);
  });

  it('高优先级规则不匹配时继续判断后续规则', () => {
    const data = createDemoData();
    const project = data.projects[0];
    startTest(data, project.id, 1);
    const user = data.users.find((item) => item.userId === 'U1004')!;
    const result = evaluateUser(project, user);

    expect(result.default).toBe(true);
    expect(result.value).toBe('旧版支付页面（默认收银台）');
    expect(result.steps.some((step) => step.detail.includes('用户编号不匹配'))).toBe(true);
  });
});

describe('按比例开放和稳定性', () => {
  it('灰度阶段根据稳定哈希分桶，重复访问结果一致', () => {
    const data = createDemoData();
    const project = data.projects[0];
    startTest(data, project.id, 1);
    startGray(data, project.id, 10, 2);

    data.users.forEach((user) => {
      const first = evaluateUser(project, user);
      const second = evaluateUser(project, user);
      expect(second.value).toBe(first.value);
      expect(second.matchedRule?.id).toBe(first.matchedRule?.id);
      expect(second.bucket).toBe(first.bucket);
    });
  });

  it('10% 到 50% 扩大后命中集合只能增加或不变', () => {
    const data = createDemoData();
    const project = data.projects[0];
    startTest(data, project.id, 1);
    startGray(data, project.id, 10, 2);
    const before = new Set(data.users.filter((user) => !evaluateUser(project, user).default).map((user) => user.userId));

    expandGray(data, project.id, 50, 3);
    const after = new Set(data.users.filter((user) => !evaluateUser(project, user).default).map((user) => user.userId));

    expect([...before].every((id) => after.has(id))).toBe(true);
    expect(after.size).toBeGreaterThanOrEqual(before.size);
  });

  it('分桶值由配置、规则和用户编号共同决定且范围为 0-99', () => {
    const bucketA = getUserBucket('cfg', 'rule', 'U1001');
    const bucketB = getUserBucket('cfg', 'rule', 'U1002');
    expect(bucketA).toBeGreaterThanOrEqual(0);
    expect(bucketA).toBeLessThan(100);
    expect(bucketA).toBe(getUserBucket('cfg', 'rule', 'U1001'));
    expect(bucketB).not.toBe(bucketA);
  });
});

describe('版本生成、比较和回滚', () => {
  it('每次保存草稿生成新版本且能列出字段差异', () => {
    const data = createDemoData();
    const project = data.projects[0];
    const before = project.versions[0].config;
    const after = structuredClone(before);
    after.rules[0].effect.value = '新版支付页面-修正包';
    after.defaultValue = '旧版支付页面（紧急兜底）';
    saveDraft(data, project.id, after, '调整内部测试值', 1);

    expect(project.versions[0].version).toBe(2);
    expect(project.activeVersionNumber).toBe(1);
    const diff = compareConfigs(before, after);
    expect(diff.some((item) => item.path === '默认配置值')).toBe(true);
    expect(diff.some((item) => item.path.includes('内部测试账号'))).toBe(true);
  });

  it('回滚生成新版本、保留历史，并让新请求读取回滚内容', () => {
    const data = createDemoData();
    const project = data.projects[0];
    startTest(data, project.id, 1);
    const stableV1 = project.versions[0];
    expect(stableV1.version).toBe(1);

    const changed = structuredClone(stableV1.config);
    changed.rules[0].effect.value = '有问题的支付实验';
    saveDraft(data, project.id, changed, '准备问题版本', 2);
    startTest(data, project.id, 3);
    expect(project.activeVersionNumber).toBe(2);
    expect(evaluateUser(project, data.users[0]).value).toBe('有问题的支付实验');

    const historyCount = project.versions.length;
    rollback(data, project.id, 1, 4);

    expect(project.activeVersionNumber).toBe(3);
    expect(project.previousVersionNumber).toBe(2);
    expect(project.versions.length).toBe(historyCount + 1);
    expect(project.versions.some((version) => version.version === 2)).toBe(true);
    expect(evaluateUser(project, data.users[0]).value).toBe('新版支付页面-内部测试包');
    expect(project.versions[0].rollbackFromVersion).toBe(2);
  });
});

describe('并发冲突', () => {
  it('旧修订号提交不能覆盖新版本', () => {
    let data = createDemoData();
    saveData(data);
    data = JSON.parse(JSON.stringify(data));
    const projectId = data.projects[0].id;
    const changedA = structuredClone(data.projects[0].versions[0].config);
    changedA.rules[0].effect.value = '窗口 A 修改';
    saveDraft(data, projectId, changedA, '窗口 A', 1);

    const changedB = structuredClone(data.projects[0].versions.find((v) => v.version === 1)!.config);
    changedB.rules[0].effect.value = '窗口 B 修改';
    expect(() => saveDraft(data, projectId, changedB, '窗口 B', 1)).toThrow(ConflictError);
    recordConflictResolution(data, projectId, 1, 'reload');

    expect(data.projects[0].versions[0].config.rules[0].effect.value).toBe('窗口 A 修改');
    expect(data.logs[0].type).toBe('conflict_resolve');
  });
});

describe('默认配置', () => {
  it('无规则或所有条件不匹配时返回默认配置并解释过程', () => {
    let data = resetData();
    data = createProject(data, {
      name: '空规则项目',
      description: '测试默认配置',
      defaultValue: '默认搜索样式'
    }, 0);
    startTest(data, data.projects[0].id, 1);
    const project = data.projects[0];
    const user = { id: 'x', name: '陌生人', userId: 'X9', region: '火星', device: 'web' as const, tags: [] };
    const result = evaluateUser(project, user);

    expect(result.default).toBe(true);
    expect(result.value).toBe('默认搜索样式');
    expect(result.matchedRule).toBeNull();
    expect(result.steps.at(-1)?.detail).toContain('默认配置');
  });

  it('草稿阶段即使存在规则也不会对外生效', () => {
    const data = createDemoData();
    const project = demoProject();
    const result = evaluateUser(project, data.users[0]);
    expect(result.default).toBe(true);
    expect(result.stage).toBe('draft');
  });

  it('紧急发布会记录原因，且缺少原因时失败', () => {
    const data = createDemoData();
    expect(() => emergencyRelease(data, data.projects[0].id, '短')).toThrow();
    emergencyRelease(data, data.projects[0].id, '线上故障需要立即切换兜底配置', 1);
    expect(data.projects[0].status).toBe('full');
    expect(data.projects[0].versions[0].emergencyReason).toContain('线上故障');
  });
});
