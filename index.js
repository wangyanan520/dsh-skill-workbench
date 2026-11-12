// dsh-skill-workbench · 宿主插件入口
// 零构建、纯 ESM；任何异常只 console.error，绝不让宿主 boot 失败。
import { applyHostPlugin } from './host/routes.js';

export const name = 'dsh-skill-workbench';
export const inject = ['webServer', 'skills'];

export function apply(ctx, config) {
  try {
    applyHostPlugin(ctx, config);
  } catch (error) {
    console.error('[dsh-skill-workbench] apply 失败', error);
  }
}
