import type { ReactNode } from 'react';
import type { ConfigStatus } from '../engine/types';
import { statusLabel } from '../state/store';
import type { Toast } from '../state/useStore';

export function StatusBadge({ status }: { status: ConfigStatus }) {
  return <span className={`badge ${status}`}>{statusLabel(status)}</span>;
}

export function Toasts({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function KeyValueEditor({
  values,
  onChange,
  keyPlaceholder = '键',
  valuePlaceholder = '值',
}: {
  values: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
}) {
  const entries = Object.entries(values);
  const update = (oldKey: string, key: string, value: string) => {
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries(values)) {
      if (k === oldKey) next[key] = value;
      else next[k] = v;
    }
    onChange(next);
  };
  const remove = (key: string) => {
    const next = { ...values };
    delete next[key];
    onChange(next);
  };
  return (
    <div>
      {entries.map(([key, value]) => (
        <div className="kv-grid" key={key}>
          <input
            value={key}
            placeholder={keyPlaceholder}
            onChange={(e) => update(key, e.target.value, value)}
          />
          <input
            value={value}
            placeholder={valuePlaceholder}
            onChange={(e) => update(key, key, e.target.value)}
          />
          <button
            type="button"
            className="danger small"
            onClick={() => remove(key)}
          >
            删除
          </button>
        </div>
      ))}
      <button
        type="button"
        className="small"
        onClick={() =>
          onChange({ ...values, [`key_${entries.length + 1}`]: '' })
        }
      >
        + 新增配置项
      </button>
    </div>
  );
}

export function KVView({ data }: { data: Record<string, string> }) {
  return (
    <div>
      {Object.entries(data).map(([k, v]) => (
        <span className="pill mono" key={k}>
          {k}={v}
        </span>
      ))}
    </div>
  );
}

export function Section({
  title,
  children,
  extra,
}: {
  title: string;
  children: ReactNode;
  extra?: ReactNode;
}) {
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ marginBottom: extra ? 0 : 12 }}>{title}</h2>
        {extra}
      </div>
      <div style={{ marginTop: 12 }}>{children}</div>
    </div>
  );
}

export function fmtTime(iso: string): string {
  if (!iso) return '-';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(
    d.getHours(),
  )}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
