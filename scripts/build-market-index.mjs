#!/usr/bin/env node
/**
 * 生成 DSH 插件市场索引（format 1）。
 *
 * 用法（发布 npm 之后）：
 *   node scripts/build-market-index.mjs
 *   node scripts/build-market-index.mjs --registry https://registry.npmjs.org
 *
 * 输出：market/index.json，可直接托管到 GitHub Pages / raw.githubusercontent.com，
 * 用户在 DSH 的 Plugins → Experimental plugins → Custom plugin indexes → Discover 里
 * 添加它的 https 地址即可看到并安装本插件。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const registry = (argValue('--registry', process.env.npm_config_registry) || 'https://registry.npmjs.org').replace(/\/+$/, '');
const outFile = path.join(ROOT, 'market', 'index.json');
const icon = fs.readFileSync(path.join(ROOT, 'assets', 'icon.svg')).toString('base64');
const repoUrl = pkg.repository?.url ? pkg.repository.url.replace(/^git\+/, '').replace(/\.git$/, '') : 'https://github.com/wangyanan520/dsh-skill-workbench';

async function main() {
  const url = `${registry}/${encodeURIComponent(pkg.name)}`;
  let meta;
  try {
    const response = await fetch(url, { headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    meta = await response.json();
  } catch (error) {
    console.error(`读取 npm 元数据失败：${url}`);
    console.error(`  ${error.message}`);
    console.error('请先执行 npm publish，确认包已在 registry 上可见后再生成市场索引。');
    process.exitCode = 1;
    return;
  }

  const version = meta['dist-tags']?.latest;
  const publishedAt = version ? meta.time?.[version] : null;
  if (!version || !publishedAt) {
    console.error(`registry 上没有 ${pkg.name} 的已发布版本（dist-tags.latest 缺失）。`);
    process.exitCode = 1;
    return;
  }
  const publishTimestamp = Math.floor(Date.parse(publishedAt) / 1000);
  if (!Number.isInteger(publishTimestamp) || publishTimestamp <= 0) {
    console.error(`发布时间的解析失败：${publishedAt}`);
    process.exitCode = 1;
    return;
  }

  const index = {
    format: 1,
    title: { en: 'Skill Workbench plugin index', zh: '技能管理插件索引' },
    description: {
      en: 'Chinese display names and descriptions for DSH skills, plus uninstall and a recycle bin.',
      zh: '为 DSH 技能补中文显示名与简介；支持修改、卸载、回收站与从安装来源读取简介。',
    },
    metadata: { categories: {}, labels: {}, sortKeys: {} },
    plugins: [
      {
        name: pkg.name,
        title: { en: 'Skill Workbench', zh: '技能管理' },
        description: {
          en: pkg.description,
          zh: '给技能加一层中文显示中间层：/ 菜单按中文分类显示中文名与简介，调用 token 仍是英文 /name；支持修改中文名、卸载到回收站、从安装来源读取简介。',
        },
        icon: `data:image/svg+xml;base64,${icon}`,
        author: 'wangyanan520',
        homepage: repoUrl,
        repository: { url: repoUrl },
        metadata: {
          keywords: pkg.keywords ?? [],
          labels: [],
          sortKeys: {},
        },
        versions: [
          {
            version,
            publishTimestamp,
            source: { type: 'npm' },
            engines: { dsh: pkg.engines?.dsh ?? '>=0.2.2-rc.1' },
          },
        ],
      },
    ],
  };

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, `${JSON.stringify(index, null, 2)}\n`);
  console.log(`已生成 ${path.relative(ROOT, outFile)}（${pkg.name}@${version}，发布于 ${publishedAt}）`);
}

await main();
