export type ConfigStatus = 'draft' | 'testing' | 'gray' | 'full' | 'rolled_back';

export type DeviceType = 'ios' | 'android' | 'web';

export interface TestUser {
  id: string;
  name: string;
  userId: string;
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

export interface RuleEffect {
  enabled: boolean;
  value: string;
  rolloutPercent: number;
}

export interface Rule {
  id: string;
  name: string;
  priority: number;
  enabled: boolean;
  condition: RuleCondition;
  effect: RuleEffect;
}

export interface RuleConfig {
  rules: Rule[];
  defaultValue: string;
}

export type VersionStage = ConfigStatus;

export interface ConfigVersion {
  version: number;
  createdAt: string;
  createdBy: string;
  changeSummary: string;
  stage: VersionStage;
  rolloutPercent: number;
  config: RuleConfig;
  stable: boolean;
  rollbackFromVersion?: number;
  emergencyReason?: string;
}

export type OperationResult = 'success' | 'failed' | 'conflict' | 'info';

export interface OperationLog {
  id: string;
  time: string;
  type:
    | 'create'
    | 'edit'
    | 'start_test'
    | 'start_gray'
    | 'expand'
    | 'full_release'
    | 'emergency_release'
    | 'rollback'
    | 'conflict'
    | 'conflict_resolve'
    | 'reset';
  configName: string;
  configId: string;
  version?: number;
  previousVersion?: number;
  detail: string;
  result: OperationResult;
}

export interface ConfigProject {
  id: string;
  name: string;
  description: string;
  status: ConfigStatus;
  createdAt: string;
  updatedAt: string;
  revision: number;
  draft: RuleConfig | null;
  activeVersionNumber: number;
  previousVersionNumber: number | null;
  versions: ConfigVersion[];
}

export interface AppData {
  projects: ConfigProject[];
  users: TestUser[];
  logs: OperationLog[];
  revision: number;
}

export interface EvaluationStep {
  ruleId?: string;
  ruleName?: string;
  passed: boolean;
  detail: string;
}

export interface EvaluationResult {
  enabled: boolean;
  value: string;
  matchedRule: Rule | null;
  default: boolean;
  bucket: number | null;
  steps: EvaluationStep[];
  stage: VersionStage;
  version: number;
}
