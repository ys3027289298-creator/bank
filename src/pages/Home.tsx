import { useState } from 'react';
import type { ConfigProject, DemoUser } from '../engine/types';
import { statusLabel, type Store, type ActionResult } from '../state/store';
import { KeyValueEditor, StatusBadge, fmtTime } from '../components/ui';

const DEMO_STEPS = [
  '① 进入演示项目「支付页面新版收银台」（已配好白名单/北京VIP/新用户10%/iOS50% 四条规则）',
  '② 在「规则与预览」标签选择不同演示用户，查看真实判断过程与桶号',
  '③ 在「发布」标签点击「开始测试」，再以 10% 开始灰度，观察影响面预测',
  '④ 在「结果预览」分别查看 U1001（白名单）、U1002（北京VIP）、U1004/U1010（新用户）、普通用户的结果',
  '⑤ 回到「发布」把范围扩大到 50%，再次预览，验证同一用户结果稳定',
  '⑥ 到「版本记录」回滚到测试时的稳定版本，新访问立即全部回退到旧配置',
  '⑦ 在「冲突演练」中打开两个窗口，先后提交，观察版本冲突拦截与三种处理方式',
];

export function Home({
  store,
  projects,
  users,
  onOpen,
  onAction,
  onReset,
}: {
  store: Store;
  projects: ConfigProject[];
  users: DemoUser[];
  onOpen: (id: string) => void;
  onAction: (
    fn: () => ActionResult<any>,
    ok: string,
    pending?: string,
  ) => boolean;
  onReset: () => void;
}) {
  const [name, setName] = useState('搜索功能新版');
  const [description, setDescription] = useState('搜索结果页排序与样式灰度');
  const [defaults, setDefaults] = useState<Record<string, string>>({
    search_ui: 'classic',
    rank_strategy: 'v1',
  });
  const [error, setError] = useState('');

  const create = () => {
    setError('');
    const result = store.createProject({
      name,
      description,
      defaultConfig: defaults,
      author: 'me',
    });
    if (!result.ok) {
      setError(result.error!);
      return;
    }
    onAction(() => ({ ok: true }), '配置已创建，生成 v1 草稿');
    onOpen(result.data!.id!);
  };

  return (
    <div className="container">
      <div className="card">
        <h2>灰度配置发布与回滚演练台</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          真实的规则判断引擎（用户编号 / 地区 / 设备 / 标签 + 优先级 + 稳定哈希分桶比例）、
          不可跳步的发布状态机、每次变更生成新版本、任意稳定版本回滚、乐观锁并发冲突检测。
          数据持久化在浏览器 localStorage，刷新不丢失。
        </p>
        <div className="banner info">
          <strong>推荐演示流程（完整覆盖 10% → 50% → 回滚）：</strong>
          <ol style={{ margin: '8px 0 0 18px', padding: 0 }}>
            {DEMO_STEPS.map((s) => (
              <li key={s} style={{ marginBottom: 3 }}>
                {s}
              </li>
            ))}
          </ol>
        </div>
        <div className="row">
          <button
            className="primary"
            disabled={projects.length === 0}
            onClick={() => onOpen(projects[0].id)}
          >
            ▶ 直接体验演示场景
          </button>
          <button
            onClick={() => {
              onReset();
              onAction(() => ({ ok: true }), '已恢复内置演示数据', '正在重新生成演示数据…');
            }}
          >
            重置为演示数据
          </button>
          <button
            className="danger"
            onClick={() => {
              if (window.confirm('确认清空全部配置、版本与操作记录？')) {
                store.wipe();
                onAction(() => ({ ok: true }), '已清空，可从零创建配置');
              }
            }}
          >
            清空全部数据重新开始
          </button>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <h2>配置列表（{projects.length}）</h2>
          <table>
            <thead>
              <tr>
                <th>名称 / 说明</th>
                <th style={{ width: 90 }}>状态</th>
                <th style={{ width: 80 }}>版本</th>
                <th style={{ width: 150 }}>修改时间</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => {
                const v = p.versions[p.versions.length - 1];
                return (
                  <tr
                    key={p.id}
                    style={{ cursor: 'pointer' }}
                    onClick={() => onOpen(p.id)}
                  >
                    <td>
                      <a>{v.snapshot.name}</a>
                      <div className="muted">{v.snapshot.description}</div>
                    </td>
                    <td>
                      <StatusBadge status={p.status} />
                    </td>
                    <td className="mono">v{p.currentVersion}</td>
                    <td className="mono">{fmtTime(p.updatedAt)}</td>
                  </tr>
                );
              })}
              {projects.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">
                    还没有配置，请在右侧创建，或点击「重置为演示数据」。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <h3>演示用户（{users.length}，结果均实时计算）</h3>
          <div>
            {users.map((u) => (
              <span className="pill" key={u.id}>
                {u.id} {u.name.split('（')[0]}·{u.region}·{u.device}
                {u.tags.length ? '·' + u.tags.join('/') : ''}
              </span>
            ))}
          </div>
        </div>

        <div className="card">
          <h2>创建配置项目</h2>
          <label className="field">
            <span>名称 *</span>
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            <span>说明</span>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <label className="field">
            <span>默认（旧）配置，未命中任何规则时下发 *</span>
            <KeyValueEditor values={defaults} onChange={setDefaults} />
          </label>
          {error && <div className="error-text">{error}</div>}
          <button className="primary" onClick={create}>
            创建（进入草稿，再配置规则）
          </button>
          <div className="muted" style={{ marginTop: 8 }}>
            当前状态：{statusLabel('draft')}。创建后请按 草稿 → 测试 → 灰度 → 全量
            的真实流程发布。
          </div>
        </div>
      </div>
    </div>
  );
}
