import type { AppData, ConfigProject, RuleConfig, TestUser } from './types';
import { createId } from './store';

export const demoUsers: TestUser[] = [
  { id: 'u1', name: '内部测试账号-小测', userId: 'U1001', region: '上海', device: 'ios', tags: ['员工', '内测'] },
  { id: 'u2', name: '上海高端用户-王女士', userId: 'U1002', region: '上海', device: 'android', tags: ['高价值'] },
  { id: 'u3', name: '北京 iOS 用户-李先生', userId: 'U1003', region: '北京', device: 'ios', tags: ['高频'] },
  { id: 'u4', name: '广州安卓用户-陈女士', userId: 'U1004', region: '广州', device: 'android', tags: ['普通'] },
  { id: 'u5', name: '深圳 Web 用户-赵先生', userId: 'U1005', region: '深圳', device: 'web', tags: ['普通'] },
  { id: 'u6', name: '成都新用户-周女士', userId: 'U1006', region: '成都', device: 'ios', tags: ['新用户'] },
  { id: 'u7', name: '杭州安卓用户-吴先生', userId: 'U1007', region: '杭州', device: 'android', tags: ['高频'] },
  { id: 'u8', name: '武汉 Web 用户-郑女士', userId: 'U1008', region: '武汉', device: 'web', tags: ['普通'] },
  { id: 'u9', name: '西安安卓用户-孙先生', userId: 'U1009', region: '西安', device: 'android', tags: ['普通'] },
  { id: 'u10', name: '南京 iOS 用户:刘女士', userId: 'U1010', region: '南京', device: 'ios', tags: ['高价值'] }
];

export const demoConfig: RuleConfig = {
  defaultValue: '旧版支付页面（默认收银台）',
  rules: [
    {
      id: 'rule-internal',
      name: '内部测试账号优先验证',
      priority: 1,
      enabled: true,
      condition: {
        userIds: ['U1001'],
        regions: [],
        devices: [],
        tags: ['内测']
      },
      effect: {
        enabled: true,
        value: '新版支付页面-内部测试包',
        rolloutPercent: 100
      }
    },
    {
      id: 'rule-vip-region',
      name: '上海高价值用户',
      priority: 2,
      enabled: true,
      condition: {
        userIds: ['U1002'],
        regions: ['上海'],
        devices: [],
        tags: ['高价值']
      },
      effect: {
        enabled: true,
        value: '新版支付页面-VIP体验',
        rolloutPercent: 100
      }
    },
    {
      id: 'rule-ios',
      name: 'iOS 用户逐步灰度',
      priority: 3,
      enabled: true,
      condition: {
        userIds: [],
        regions: [],
        devices: ['ios'],
        tags: []
      },
      effect: {
        enabled: true,
        value: '新版支付页面-iOS灰度',
        rolloutPercent: 100
      }
    },
    {
      id: 'rule-android',
      name: '安卓用户保底规则',
      priority: 4,
      enabled: true,
      condition: {
        userIds: [],
        regions: [],
        devices: ['android'],
        tags: []
      },
      effect: {
        enabled: true,
        value: '新版支付页面-安卓灰度',
        rolloutPercent: 50
      }
    }
  ]
};

export function createDemoData(): AppData {
  const createdAt = new Date().toISOString();
  const project: ConfigProject = {
    id: 'demo-payment-config',
    name: '支付页面新版',
    description: '演示新收银台从内部测试、10% 灰度、50% 扩大到异常回滚的完整发布过程。',
    status: 'draft',
    createdAt,
    updatedAt: createdAt,
    revision: 0,
    draft: structuredClone(demoConfig),
    activeVersionNumber: 1,
    previousVersionNumber: null,
    versions: [
      {
        version: 1,
        createdAt,
        createdBy: '系统演示',
        changeSummary: '创建演示配置：默认旧收银台，并配置内部、VIP、iOS 与安卓规则',
        stage: 'draft',
        rolloutPercent: 0,
        config: structuredClone(demoConfig),
        stable: false
      }
    ]
  };

  return {
    revision: 1,
    users: structuredClone(demoUsers),
    projects: [project],
    logs: [
      {
        id: createId('log'),
        time: createdAt,
        type: 'create',
        configName: project.name,
        configId: project.id,
        version: 1,
        detail: '载入内置演示数据：10 名演示用户和 4 条带优先顺序的真实规则。',
        result: 'info'
      }
    ]
  };
}
