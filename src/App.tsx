import { useState } from 'react';
import { Home } from './pages/Home';
import { ProjectDetail } from './pages/ProjectDetail';
import { Toasts } from './components/ui';
import { useStore } from './state/useStore';

export function App() {
  const { store, tick, refresh, run, toasts } = useStore();
  const [openId, setOpenId] = useState<string | null>(null);

  const data = store.getAll();

  return (
    <div>
      <div className="topbar">
        <h1>灰度发布演练台</h1>
        <span className="sub">Gray Release Lab · 规则引擎 / 版本 / 发布 / 回滚 / 冲突</span>
        <div className="spacer" />
        <button className="small" onClick={() => setOpenId(null)}>
          首页
        </button>
        <button
          className="small"
          onClick={() => {
            store.reset();
            refresh();
            setOpenId(null);
          }}
        >
          重置演示数据
        </button>
      </div>

      {openId && store.getProject(openId) ? (
        <ProjectDetail
          store={store}
          projectId={openId}
          users={data.users}
          onBack={() => setOpenId(null)}
          onAction={run}
          tick={tick}
        />
      ) : (
        <Home
          store={store}
          projects={data.projects}
          users={data.users}
          onOpen={setOpenId}
          onAction={run}
          onReset={() => {
            store.reset();
            refresh();
          }}
        />
      )}

      <Toasts toasts={toasts} />
    </div>
  );
}
