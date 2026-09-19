export type ConfigStatus =
  | 'draft'
  | 'testing'
  | 'gray'
  | 'full'
  | 'rolled_back';

export type DeviceType = 'iOS' | 'Android' | 'Web' | 'MiniProgram';

export interface DemoUser {
  id: string;
  name: string;
  region: string;
  device: DeviceType;
  tags: string[];
}

export interface RuleCondition {
  userIds: string[];
  regions: string[];
  devices: DeviceType[];
  tags: string[];
}

export interface Rule {
  id: string;
  name: string;
  enabled: boolean;
  /** 数字越小优先级越高 */
  priority: number;
  condition: RuleCondition;
  /** 命中该规则后开放的比例 0-100，仅在灰度状态下参与判断 */
  percent: number;
  /** 命中规则后下发的变体配置（键值对） */
  output: Record<string, string>;
}

export interface ConfigSnapshot {
  name: string;
  description: string;
  defaultConfig: Record<string, string>;
  rules: Rule[];
}

export type ChangeType =
  | 'create'
  | 'edit'
  | 'start_testing'
  | 'start_gray'
  | 'expand_gray'
  | 'full_release'
  | 'emergency_release'
  | 'rollback';

export interface Version {
  version: number;
  createdAt: string;
  author: string;
  changeType: ChangeType;
  message: string;
  snapshot: ConfigSnapshot;
  /** 灰度比例，仅灰度相关版本有意义 */
  grayPercent: number | null;
  /** 是否曾经真正生效（进入过测试/灰度/全量），稳定版本才可回滚 */
  stable: boolean;
  status: ConfigStatus;
}

export interface ConfigProject {
  id: string;
  status: ConfigStatus;
  currentVersion: number;
  /** 当前灰度比例（0-100），仅 gray 状态使用 */
  grayPercent: number;
  versions: Version[];
  createdAt: string;
  updatedAt: string;
}

export interface AuditLog {
  id: string;
  time: string;
  action: ChangeType | 'conflict_blocked' | 'conflict_forced' | 'reset';
  configId: string;
  configName: string;
  version: number | null;
  fromVersion?: number;
  toVersion?: number;
  result: 'success' | 'blocked' | 'info';
  detail: string;
  reason?: string;
}

export interface ConditionTrace {
  dimension: string;
  expected: string;
  actual: string;
  pass: boolean;
}

export interface RuleTrace {
  ruleId: string;
  ruleName: string;
  priority: number;
  enabled: boolean;
  conditionTraces: ConditionTrace[];
  conditionsMatched: boolean;
  bucket: number | null;
  percent: number | null;
  percentPassed: boolean | null;
  /** 该规则最终是否被选中下发 */
  hit: boolean;
  skipReason?: string;
}

export interface EvalResult {
  variant: 'new' | 'default';
  output: Record<string, string>;
  matchedRuleId: string | null;
  matchedRuleName: string | null;
  traces: RuleTrace[];
  gateReason: string;
}

export interface StoreData {
  projects: ConfigProject[];
  users: DemoUser[];
  logs: AuditLog[];
  seq: number;
}
