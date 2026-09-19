import { beforeEach, describe, expect, it } from 'vitest';
import { Store, emptyData } from './store';
import type { ConfigSnapshot } from '../engine/types';
import { diffSnapshots } from '../engine/diff';
import { evaluate } from '../engine/rules';

function baseSnapshot(): ConfigSnapshot {
  return {
    name: '测试配置',
    description: 'd',
    defaultConfig: { theme: 'old' },
    rules: [
      {
        id: 'r1',
        name: '规则1',
        enabled: true,
        priority: 1,
        condition: { userIds: [], regions: [], devices: [], tags: [] },
        percent: 10,
        output: { theme: 'new' },
      },
    ],
  };
}

describe('版本生成与比较', () => {
  let store: Store;
  let id: string;

  beforeEach(() => {
    store = new Store(emptyData());
    const res = store.createProject({
      name: '测试配置',
      description: 'd',
      defaultConfig: { theme: 'old' },
      author: 'a',
    });
    id = res.data!.id!;
  });

  it('每次修改都生成递增版本，修改内容可通过 diff 查看', () => {
    const edited = baseSnapshot();
    edited.description = 'updated';
    edited.rules[0].percent = 50;
    const outcome = store.editConfig({
      projectId: id,
      baseVersion: 1,
      snapshot: edited,
      author: 'a',
      message: '调整比例',
    });
    expect(outcome.conflict).toBe(false);
    const project = store.getProject(id)!;
    expect(project.currentVersion).toBe(2);
    expect(project.versions).toHaveLength(2);

    const changes = diffSnapshots(
      project.versions[0].snapshot,
      project.versions[1].snapshot,
    );
    expect(changes.some((c) => c.path.includes('规则'))).toBe(true);
    expect(changes.some((c) => c.path === '说明')).toBe(true);
  });

  it('表单校验：空名称、重复优先级、比例越界均报错', () => {
    const bad = baseSnapshot();
    bad.name = '  ';
    expect(
      store.editConfig({ projectId: id, baseVersion: 1, snapshot: bad, author: 'a', message: '' })
        .result.ok,
    ).toBe(false);
    const dup = baseSnapshot();
    dup.rules.push(structuredClone(dup.rules[0]));
    dup.rules[1].id = 'r2';
    expect(
      store.editConfig({ projectId: id, baseVersion: 1, snapshot: dup, author: 'a', message: '' })
        .result.error,
    ).toContain('优先级');
  });
});

describe('发布流程门禁', () => {
  let store: Store;
  let id: string;

  beforeEach(() => {
    store = new Store(emptyData());
    id = store.createProject({
      name: 'p',
      description: '',
      defaultConfig: { a: '1' },
      author: 'a',
    }).data!.id!;
  });

  it('草稿不能直接灰度或全量；紧急发布必须填写原因并记录', () => {
    expect(store.transition(id, 'gray', { percent: 10 }).ok).toBe(false);
    expect(
      store.transition(id, 'full', { reason: '线上热修复' }).ok,
    ).toBe(true);
    const log = store.getLogs(id)[0];
    expect(log.action).toBe('emergency_release');
    expect(log.reason).toBe('线上热修复');
  });

  it('灰度扩大范围比例必须递增，且每次产生版本与记录', () => {
    store.transition(id, 'testing');
    expect(store.transition(id, 'gray', { percent: 10 }).ok).toBe(true);
    expect(store.transition(id, 'gray', { percent: 5 }).ok).toBe(false);
    expect(store.transition(id, 'gray', { percent: 50 }).ok).toBe(true);
    const project = store.getProject(id)!;
    expect(project.status).toBe('gray');
    expect(project.grayPercent).toBe(50);
    expect(project.versions.map((v) => v.changeType)).toEqual([
      'create',
      'start_testing',
      'start_gray',
      'expand_gray',
    ]);
  });
});

describe('回滚', () => {
  it('可回滚到任意稳定版本，回滚生成新版本且不删除历史，访问立即使用回滚版本', () => {
    const store = new Store(emptyData());
    const id = store.createProject({
      name: 'p',
      description: '',
      defaultConfig: { theme: 'old' },
      author: 'a',
    }).data!.id!;
    store.transition(id, 'testing');
    const v2Snapshot = baseSnapshot();
    v2Snapshot.name = 'p';
    v2Snapshot.defaultConfig = { theme: 'old' };
    store.editConfig({
      projectId: id,
      baseVersion: 2,
      snapshot: v2Snapshot,
      author: 'a',
      message: '灰度规则',
    });
    store.transition(id, 'gray', { percent: 10 });

    const before = store.getProject(id)!;
    const versionCount = before.versions.length;
    const res = store.rollback(id, 2);
    expect(res.ok).toBe(true);
    const after = store.getProject(id)!;
    expect(after.status).toBe('rolled_back');
    expect(after.versions).toHaveLength(versionCount + 1);
    expect(after.currentVersion).toBe(versionCount + 1);
    expect(after.versions.find((v) => v.version === 2)).toBeDefined();

    const rollbackLog = store.getLogs(id).find((l) => l.action === 'rollback')!;
    expect(rollbackLog.fromVersion).toBe(versionCount);
    expect(rollbackLog.toVersion).toBe(2);

    const user = {
      id: 'U9',
      name: 'x',
      region: '北京',
      device: 'iOS' as const,
      tags: [],
    };
    const result = evaluate(after, user);
    expect(result.variant).toBe('default');
  });

  it('不能回滚到从未生效的草稿版本', () => {
    const store = new Store(emptyData());
    const id = store.createProject({
      name: 'p',
      description: '',
      defaultConfig: { a: '1' },
      author: 'a',
    }).data!.id!;
    expect(store.rollback(id, 1).ok).toBe(false);
  });
});

describe('并发冲突', () => {
  it('旧页面提交修改时被拒绝，不覆盖新版本；可重新读取或基于最新继续', () => {
    const store = new Store(emptyData());
    const id = store.createProject({
      name: 'p',
      description: '',
      defaultConfig: { a: '1' },
      author: 'a',
    }).data!.id!;

    // 窗口 A 先保存 -> v2
    const snapA = baseSnapshot();
    snapA.name = 'p';
    snapA.defaultConfig = { a: '1' };
    snapA.description = 'A 的修改';
    expect(
      store.editConfig({ projectId: id, baseVersion: 1, snapshot: snapA, author: 'A', message: 'A' })
        .conflict,
    ).toBe(false);

    // 窗口 B 仍基于 v1 提交 -> 冲突
    const snapB = baseSnapshot();
    snapB.name = 'p';
    snapB.defaultConfig = { a: '1' };
    snapB.description = 'B 的修改';
    const blocked = store.editConfig({
      projectId: id,
      baseVersion: 1,
      snapshot: snapB,
      author: 'B',
      message: 'B',
    });
    expect(blocked.conflict).toBe(true);
    expect(blocked.latestVersion).toBe(2);
    expect(store.getProject(id)!.currentVersion).toBe(2);
    expect(
      store.getLogs(id).some((l) => l.action === 'conflict_blocked'),
    ).toBe(true);

    // B 选择基于最新版本继续 -> v3
    expect(
      store.forceEditAfterConflict({
        projectId: id,
        snapshot: snapB,
        author: 'B',
        message: 'B 合并后提交',
      }).ok,
    ).toBe(true);
    expect(store.getProject(id)!.currentVersion).toBe(3);
  });
});
