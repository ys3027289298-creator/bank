import { describe, expect, it, beforeEach, vi } from 'vitest';
// @vitest-environment jsdom
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { demoData } from './state/demoData';

beforeEach(() => localStorage.clear());

describe('完整 UI 冒烟', () => {
  it(
    '开始页 → 演示项目 → 测试 → 10%灰度 → 50% → 回滚 → 记录',
    async () => {
      localStorage.setItem(
        'gray-release-lab-v1',
        JSON.stringify(demoData),
      );
      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = createRoot(container);
      await act(async () => root.render(<App />));

      await act(async () => {
        (
          container
            .querySelectorAll('button')[
              Array.from(container.querySelectorAll('button')).findIndex(
                (b) => b.textContent!.includes('直接体验演示场景'),
              )
            ] as HTMLButtonElement
        ).click();
      });
      expect(container.textContent).toContain('支付页面新版收银台');

      const clickByText = async (text: string) => {
        const btn = Array.from(container.querySelectorAll('button')).find((b) =>
          b.textContent!.includes(text),
        ) as HTMLButtonElement;
        expect(btn, `缺少按钮: ${text}`).toBeTruthy();
        await act(async () => btn.click());
      };

      const goTab = async (name: string) =>
        act(async () =>
          (
            Array.from(container.querySelectorAll('.tabs button')).find((b) =>
              b.textContent!.includes(name),
            ) as HTMLButtonElement
          ).click(),
        );

      await goTab('发布控制台');
      await clickByText('开始测试');
      await clickByText('开始灰度');
      // 将灰度比例输入框调整为 50 后再扩大范围
      const percentInput = container.querySelector(
        'input[type="number"]',
      ) as HTMLInputElement;
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          'value',
        )!.set!;
        setter.call(percentInput, '50');
        percentInput.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await clickByText('扩大到 50');
      await goTab('结果预览');
      expect(container.textContent).toContain('判断过程');

      await goTab('版本记录与回滚');
      // 回滚到测试稳定版本（版本列表中的“回滚到此版本”按钮）
      vi.stubGlobal('confirm', () => true);
      await clickByText('回滚到此版本');
      expect(container.textContent).toContain('已回滚');

      await goTab('操作记录');
      const text = container.textContent!;
      expect(text).toContain('开始测试');
      expect(text).toContain('开始灰度');
      expect(text).toContain('扩大灰度范围');
      expect(text).toContain('回滚');

      // localStorage 持久化
      const saved = JSON.parse(localStorage.getItem('gray-release-lab-v1')!);
      expect(saved.projects[0].status).toBe('rolled_back');
      root.unmount();
    },
    15000,
  );
});
