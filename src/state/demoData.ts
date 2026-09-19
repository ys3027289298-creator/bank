import type {
  AuditLog,
  ConfigProject,
  DemoUser,
  Rule,
  StoreData,
} from '../engine/types';

const t0 = '2026-09-19T01:00:00.000Z';
const t1 = '2026-09-19T01:30:00.000Z';
const t2 = '2026-09-19T02:00:00.000Z';

export const demoUsers: DemoUser[] = [
  { id: 'U1001', name: '张伟（白名单内测）', region: '北京', device: 'iOS', tags: ['vip', 'internal'] },
  { id: 'U1002', name: '李娜（VIP-北京）', region: '北京', device: 'Android', tags: ['vip'] },
  { id: 'U1003', name: '王强（上海-安卓）', region: '上海', device: 'Android', tags: [] },
  { id: 'U1004', name: '刘洋（广州-iOS）', region: '广州', device: 'iOS', tags: ['new_user'] },
  { id: 'U1005', name: '陈静（普通用户）', region: '成都', device: 'Web', tags: [] },
  { id: 'U1006', name: '杨帆（深圳-小程序）', region: '深圳', device: 'MiniProgram', tags: ['new_user'] },
  { id: 'U1007', name: '赵敏（VIP-上海）', region: '上海', device: 'iOS', tags: ['vip'] },
  { id: 'U1008', name: '孙磊（北京-Web）', region: '北京', device: 'Web', tags: [] },
  { id: 'U1009', name: '周婷（广州-安卓）', region: '广州', device: 'Android', tags: [] },
  { id: 'U1010', name: '吴昊（成都-新用户）', region: '成都', device: 'iOS', tags: ['new_user'] },
];

const rules: Rule[] = [
  {
    id: 'rule_whitelist',
    name: '内部白名单（测试账号）',
    enabled: true,
    priority: 1,
    condition: {
      userIds: ['U1001'],
      regions: [],
      devices: [],
      tags: [],
    },
    percent: 100,
    output: { theme: 'new', payment_channel: 'new_cashier', guide: 'internal_test' },
  },
  {
    id: 'rule_vip_bj',
    name: '北京 VIP 优先体验',
    enabled: true,
    priority: 2,
    condition: {
      userIds: [],
      regions: ['北京'],
      devices: [],
      tags: ['vip'],
    },
    percent: 100,
    output: { theme: 'new', payment_channel: 'new_cashier', guide: 'vip' },
  },
  {
    id: 'rule_new_user',
    name: '新用户 10% 小流量',
    enabled: true,
    priority: 3,
    condition: {
      userIds: [],
      regions: [],
      devices: [],
      tags: ['new_user'],
    },
    percent: 10,
    output: { theme: 'new', payment_channel: 'new_cashier', guide: 'onboarding_v2' },
  },
  {
    id: 'rule_ios_beta',
    name: 'iOS 用户 50% 灰度',
    enabled: true,
    priority: 4,
    condition: {
      userIds: [],
      regions: [],
      devices: ['iOS'],
      tags: [],
    },
    percent: 50,
    output: { theme: 'new', payment_channel: 'new_cashier', guide: 'standard' },
  },
];

const snapshotV1 = {
  name: '支付页面新版收银台',
  description:
    '演示项目：新版支付收银台。先内部白名单测试，再按 VIP / 新用户 / iOS 分规则灰度，最后全量；出问题可随时回滚。',
  defaultConfig: {
    theme: 'old',
    payment_channel: 'legacy_cashier',
    guide: 'legacy',
  },
  rules: [],
};

const snapshotV2 = {
  ...snapshotV1,
  rules: structuredClone(rules),
};

const demoProject: ConfigProject = {
  id: 'cfg_demo_payment',
  status: 'draft',
  currentVersion: 2,
  grayPercent: 0,
  createdAt: t0,
  updatedAt: t2,
  versions: [
    {
      version: 1,
      createdAt: t0,
      author: 'demo',
      changeType: 'create',
      message: '创建配置',
      snapshot: structuredClone(snapshotV1),
      grayPercent: null,
      stable: false,
      status: 'draft',
    },
    {
      version: 2,
      createdAt: t2,
      author: 'demo',
      changeType: 'edit',
      message: '配置四条灰度规则（白名单/北京VIP/新用户10%/iOS50%）',
      snapshot: structuredClone(snapshotV2),
      grayPercent: null,
      stable: false,
      status: 'draft',
    },
  ],
};

const demoLogs: AuditLog[] = [
  {
    id: 'log_demo_1',
    time: t0,
    action: 'create',
    configId: 'cfg_demo_payment',
    configName: '支付页面新版收银台',
    version: 1,
    result: 'success',
    detail: '创建配置项目，生成 v1 草稿',
  },
  {
    id: 'log_demo_2',
    time: t1,
    action: 'edit',
    configId: 'cfg_demo_payment',
    configName: '支付页面新版收银台',
    version: 2,
    fromVersion: 1,
    result: 'success',
    detail: '基于 v1 生成 v2：配置四条灰度规则',
  },
];

export const demoData: StoreData = {
  projects: [demoProject],
  users: demoUsers,
  logs: demoLogs,
  seq: 100,
};
