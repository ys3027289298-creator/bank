import type { ConfigSnapshot, DeviceType, Rule } from '../engine/types';
import { KeyValueEditor } from './ui';

const DEVICES: DeviceType[] = ['iOS', 'Android', 'Web', 'MiniProgram'];

let ruleSeq = 0;
function newRule(priority: number): Rule {
  ruleSeq += 1;
  return {
    id: `rule_${Date.now().toString(36)}_${ruleSeq}`,
    name: `新规则 ${priority}`,
    enabled: true,
    priority,
    condition: { userIds: [], regions: [], devices: [], tags: [] },
    percent: 10,
    output: { key: 'value' },
  };
}

function CSVEditor({
  values,
  onChange,
  placeholder,
  suggestions,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  suggestions?: string[];
}) {
  const toggle = (v: string) => {
    onChange(values.includes(v) ? values.filter((x) => x !== v) : [...values, v]);
  };
  return (
    <div>
      <input
        value={values.join(',')}
        placeholder={placeholder}
        onChange={(e) =>
          onChange(
            e.target.value
              .split(/[,，]/)
              .map((s) => s.trim())
              .filter(Boolean),
          )
        }
      />
      {suggestions && (
        <div className="muted" style={{ marginTop: 4 }}>
          可选：
          {suggestions.map((s) => (
            <button
              type="button"
              key={s}
              className="small"
              style={{ margin: '0 4px 4px 0' }}
              onClick={() => toggle(s)}
            >
              {values.includes(s) ? '✓ ' : ''}
              {s}
            </button>
          ))}
        </div>
      )}
      <div className="muted">留空表示该维度不限制（任意值均可）</div>
    </div>
  );
}

export function RuleEditor({
  snapshot,
  onChange,
  regionSuggestions,
  tagSuggestions,
  userSuggestions,
}: {
  snapshot: ConfigSnapshot;
  onChange: (next: ConfigSnapshot) => void;
  regionSuggestions: string[];
  tagSuggestions: string[];
  userSuggestions: string[];
}) {
  const sorted = [...snapshot.rules].sort((a, b) => a.priority - b.priority);

  const updateRule = (id: string, patch: Partial<Rule>) =>
    onChange({
      ...snapshot,
      rules: snapshot.rules.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    });

  const updateCondition = (
    id: string,
    key: keyof Rule['condition'],
    value: string[],
  ) =>
    onChange({
      ...snapshot,
      rules: snapshot.rules.map((r) =>
        r.id === id ? { ...r, condition: { ...r.condition, [key]: value } } : r,
      ),
    });

  const move = (id: string, dir: -1 | 1) => {
    const order = sorted.map((r) => r.id);
    const idx = order.indexOf(id);
    const swap = idx + dir;
    if (swap < 0 || swap >= order.length) return;
    [order[idx], order[swap]] = [order[swap], order[idx]];
    const newPriority = new Map(order.map((rid, i) => [rid, i + 1]));
    onChange({
      ...snapshot,
      rules: snapshot.rules.map((r) => ({
        ...r,
        priority: newPriority.get(r.id)!,
      })),
    });
  };

  return (
    <div>
      {sorted.map((rule, idx) => (
        <div className="rule-editor" key={rule.id}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div className="row">
              <strong>
                P{rule.priority} · {rule.name || '(未命名)'}
              </strong>
              <label className="row" style={{ fontSize: 12 }}>
                <input
                  type="checkbox"
                  style={{ width: 'auto' }}
                  checked={rule.enabled}
                  onChange={(e) =>
                    updateRule(rule.id, { enabled: e.target.checked })
                  }
                />
                启用
              </label>
            </div>
            <div className="row">
              <button
                type="button"
                className="small"
                disabled={idx === 0}
                onClick={() => move(rule.id, -1)}
              >
                ↑ 提高优先级
              </button>
              <button
                type="button"
                className="small"
                disabled={idx === sorted.length - 1}
                onClick={() => move(rule.id, 1)}
              >
                ↓ 降低
              </button>
              <button
                type="button"
                className="small danger"
                onClick={() =>
                  onChange({
                    ...snapshot,
                    rules: snapshot.rules.filter((r) => r.id !== rule.id),
                  })
                }
              >
                删除规则
              </button>
            </div>
          </div>

          <div className="grid grid-2" style={{ marginTop: 8 }}>
            <label className="field">
              <span>规则名称</span>
              <input
                value={rule.name}
                onChange={(e) => updateRule(rule.id, { name: e.target.value })}
              />
            </label>
            <label className="field">
              <span>规则自身开放比例（0-100%，灰度时还会受全局上限约束）</span>
              <input
                type="number"
                min={0}
                max={100}
                value={rule.percent}
                onChange={(e) =>
                  updateRule(rule.id, { percent: Number(e.target.value) })
                }
              />
            </label>
          </div>

          <div className="grid grid-2">
            <label className="field">
              <span>命中条件 · 用户编号（逗号分隔）</span>
              <CSVEditor
                values={rule.condition.userIds}
                onChange={(v) => updateCondition(rule.id, 'userIds', v)}
                placeholder="如 U1001,U1002"
                suggestions={userSuggestions}
              />
            </label>
            <label className="field">
              <span>命中条件 · 地区</span>
              <CSVEditor
                values={rule.condition.regions}
                onChange={(v) => updateCondition(rule.id, 'regions', v)}
                placeholder="如 北京,上海"
                suggestions={regionSuggestions}
              />
            </label>
            <label className="field">
              <span>命中条件 · 用户标签</span>
              <CSVEditor
                values={rule.condition.tags}
                onChange={(v) => updateCondition(rule.id, 'tags', v)}
                placeholder="如 vip,new_user"
                suggestions={tagSuggestions}
              />
            </label>
            <label className="field">
              <span>命中条件 · 设备类型</span>
              <div className="row wrap">
                {DEVICES.map((d) => (
                  <label key={d} className="row" style={{ fontSize: 12 }}>
                    <input
                      type="checkbox"
                      style={{ width: 'auto' }}
                      checked={rule.condition.devices.includes(d)}
                      onChange={(e) =>
                        updateCondition(
                          rule.id,
                          'devices',
                          e.target.checked
                            ? [...rule.condition.devices, d]
                            : rule.condition.devices.filter((x) => x !== d),
                        )
                      }
                    />
                    {d}
                  </label>
                ))}
              </div>
            </label>
          </div>

          <label className="field">
            <span>命中后下发的新配置（变体）</span>
            <KeyValueEditor
              values={rule.output}
              onChange={(output) => updateRule(rule.id, { output })}
            />
          </label>
        </div>
      ))}
      <button
        type="button"
        className="primary"
        onClick={() =>
          onChange({
            ...snapshot,
            rules: [...snapshot.rules, newRule(sorted.length + 1)],
          })
        }
      >
        + 新增规则（优先级自动排到最后）
      </button>
    </div>
  );
}
