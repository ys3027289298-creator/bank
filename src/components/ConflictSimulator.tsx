import { useState } from 'react';
import type { ConfigProject, ConfigSnapshot } from '../engine/types';
import { type ActionResult, type Store } from '../state/store';

export function ConflictSimulator({
  project,
  store,
  onAction,
}: {
  project: ConfigProject;
  store: Store;
  onAction: (
    fn: () => ActionResult<any>,
    ok: string,
    pending?: string,
  ) => boolean;
}) {
  const current = project.versions.find(
    (v) => v.version === project.currentVersion,
  )!;
  const [windowA, setWindowA] = useState<ConfigSnapshot | null>(null);
  const [windowB, setWindowB] = useState<ConfigSnapshot | null>(null);
  const [baseVersion, setBaseVersion] = useState(project.currentVersion);
  const [conflictMsg, setConflictMsg] = useState<string | null>(null);

  const openWindows = () => {
    const snap = structuredClone(current.snapshot);
    setWindowA(snap);
    setWindowB(structuredClone(snap));
    setBaseVersion(project.currentVersion);
    setConflictMsg(null);
  };

  const patchName = (
    win: 'A' | 'B',
    snapshot: ConfigSnapshot,
    set: (s: ConfigSnapshot) => void,
    value: string,
  ) => {
    set({ ...snapshot, description: value });
  };

  const submit = (win: 'A' | 'B') => {
    const snapshot = win === 'A' ? windowA : windowB;
    if (!snapshot) return;
    const outcome = store.editConfig({
      projectId: project.id,
      baseVersion,
      snapshot,
      author: `窗口${win}`,
      message: `窗口${win} 提交的修改`,
    });
    if (outcome.conflict) {
      setConflictMsg(outcome.result.error!);
      return;
    }
    if (outcome.result.ok) {
      setConflictMsg(null);
      onAction(
        () => ({ ok: true }),
        `窗口${win} 已基于 v${baseVersion} 成功提交`,
      );
    } else {
      onAction(() => ({ ok: false, error: outcome.result.error }), '');
    }
  };

  const reread = (win: 'A' | 'B') => {
    const fresh = store.getProject(project.id)!;
    const cur = fresh.versions.find((v) => v.version === fresh.currentVersion)!;
    if (win === 'A') setWindowA(structuredClone(cur.snapshot));
    else setWindowB(structuredClone(cur.snapshot));
    setBaseVersion(fresh.currentVersion);
    setConflictMsg(null);
  };

  const discard = (win: 'A' | 'B') => {
    if (win === 'A') setWindowA(null);
    else setWindowB(null);
    setConflictMsg(null);
  };

  const continueOnLatest = (win: 'A' | 'B') => {
    const snapshot = win === 'A' ? windowA : windowB;
    if (!snapshot) return;
    onAction(
      () =>
        store.forceEditAfterConflict({
          projectId: project.id,
          snapshot,
          author: `窗口${win}`,
          message: `窗口${win} 的修改`,
        }),
      `窗口${win} 已基于最新版本合并提交，冲突处理已记录`,
    );
    setConflictMsg(null);
  };

  if (project.status === 'rolled_back')
    return (
      <div className="banner warn">
        配置处于已回滚状态，请先在「版本记录」中基于稳定版本新建修订，再演练并发冲突。
      </div>
    );

  return (
    <div>
      <div className="banner info">
        模拟两个浏览器窗口同时打开 v{baseVersion}：让窗口 A 先提交，再让窗口 B
        提交，即可触发真实的乐观锁冲突（不会静默覆盖）。
      </div>
      {(!windowA || !windowB) && (
        <button className="primary" onClick={openWindows}>
          ① 同时打开两个窗口（复制当前 v{project.currentVersion}）
        </button>
      )}

      {windowA && windowB && (
        <>
          <div className="grid grid-2">
            {(['A', 'B'] as const).map((win) => {
              const snapshot = win === 'A' ? windowA : windowB;
              const set = win === 'A' ? setWindowA : setWindowB;
              return (
                <div
                  className="trace-box"
                  key={win}
                  style={{ borderStyle: 'solid' }}
                >
                  <h3 style={{ marginTop: 0 }}>
                    窗口 {win}（打开时基于 v{baseVersion}）
                  </h3>
                  <label className="field">
                    <span>修改配置说明（模拟编辑）</span>
                    <textarea
                      rows={3}
                      value={snapshot.description}
                      onChange={(e) =>
                        patchName(win, snapshot, set, e.target.value)
                      }
                    />
                  </label>
                  <div className="muted" style={{ marginBottom: 8 }}>
                    规则数：{snapshot.rules.length}，默认配置项：
                    {Object.keys(snapshot.defaultConfig).length}
                  </div>
                  <button className="primary small" onClick={() => submit(win)}>
                    ② 提交窗口 {win} 的修改
                  </button>
                </div>
              );
            })}
          </div>

          {conflictMsg && (
            <div className="banner error">
              <strong>检测到版本冲突：</strong>
              {conflictMsg}
              <div style={{ marginTop: 8 }} className="row wrap">
                <button className="small" onClick={() => reread('B')}>
                  ③a 窗口 B 重新读取最新版本（放弃本地改动）
                </button>
                <button className="small" onClick={() => discard('B')}>
                  ③b 窗口 B 放弃修改并关闭
                </button>
                <button
                  className="small warn"
                  onClick={() => continueOnLatest('B')}
                >
                  ③c 窗口 B 基于最新版本继续修改（保留本地内容，生成新版本并记录）
                </button>
              </div>
            </div>
          )}
          <button className="small" onClick={openWindows}>
            重置演练（按当前版本重新打开两个窗口）
          </button>
        </>
      )}
    </div>
  );
}
