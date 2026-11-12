// dsh-skill-workbench · 安装来源与 GitHub 中文简介（零构建，仅 node: 内建模块）
//
// 技能安装器会在 `<agentsHome>/.skill-lock.json` 里记录每个技能的来源仓库
// （source / sourceUrl / skillPath）。中文显示层把它当作「中文名与中文简介的权威来源」：
// 安装源仓库的 README（优先中文版）里通常有每个技能的一行简介或列表项。
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { atomicWriteJson, pluginDataDir } from './util.js';

const LOCK_FILE = '.skill-lock.json';
const CACHE_FILE = 'source-cache.json';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;
const MAX_DOC_BYTES = 1024 * 1024;
const CJK_RE = /[\u3400-\u9fff\uf900-\ufaff]/;

/** 读取技能安装锁文件（v3：{skills:{name:{source,sourceUrl,skillPath,...}}}）。读不到返回 null。 */
export function readSkillLock(agentsDir) {
  const dir = typeof agentsDir === 'string' && agentsDir ? agentsDir : null;
  if (!dir) return null;
  const file = join(dir, LOCK_FILE);
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    const skills = parsed && typeof parsed === 'object' ? parsed.skills : null;
    return skills && typeof skills === 'object' && !Array.isArray(skills) ? skills : null;
  } catch {
    return null;
  }
}

/** 从锁文件里取某个技能的安装来源；没有记录返回 null。 */
export function sourceForSkill(skills, name) {
  if (!skills || typeof skills !== 'object' || typeof name !== 'string' || !name) return null;
  const entry = skills[name];
  if (!entry || typeof entry !== 'object') return null;
  const sourceUrl = typeof entry.sourceUrl === 'string' && entry.sourceUrl ? entry.sourceUrl : '';
  if (!sourceUrl) return null;
  return {
    source: typeof entry.source === 'string' && entry.source ? entry.source : sourceUrl,
    sourceUrl,
    skillPath: typeof entry.skillPath === 'string' && entry.skillPath ? entry.skillPath : null,
    installedAt: typeof entry.installedAt === 'string' ? entry.installedAt : null,
    updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : null,
  };
}

export function hasChinese(text) {
  return CJK_RE.test(String(text || ''));
}

/** 去掉 markdown 链接/强调/反引号，压成一行。 */
function cleanInline(text) {
  return String(text || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_~`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeName(text) {
  return cleanInline(text).replace(/^\s*[-*+]\s*/, '').replace(/[:：]\s*$/, '').toLowerCase();
}

/**
 * 在一份 markdown（通常是安装源仓库的 README）里找某个技能的一句话简介。
 * 支持三种常见写法：表格行 `| \`name\` | 简介 |`、列表项 `1. **name** - 简介`、标题 `## name` 后首段。
 * 返回 `{ summary, lang: 'zh'|'en' }`，找不到返回 null。
 */
export function parseSkillMention(markdown, name) {
  const text = String(markdown || '');
  const wanted = normalizeName(name);
  if (!text || !wanted) return null;
  const lines = text.split(/\r?\n/);

  // 1) 表格行：| `lark-im` | 发送/回复消息、群聊管理 |
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line.startsWith('|')) continue;
    const cells = line.replace(/^\|/, '').replace(/\|$/, '').split('|').map(cleanInline);
    if (cells.length < 2) continue;
    if (normalizeName(cells[0]) !== wanted) continue;
    const summary = cleanInline(cells[1]);
    if (!summary || /^-+$/.test(summary)) continue;
    return { summary, lang: hasChinese(summary) ? 'zh' : 'en' };
  }

  // 2) 列表项：- **name** - 简介 / 1. **name**：简介 / - `name`: 简介
  for (const rawLine of lines) {
    const line = rawLine.trim();
    const match = line.match(/^(?:[-*+]|\d+[.)])\s+(?:\*\*|`)([^`*]+?)(?:\*\*|`)\s*[-–—:：]?\s*(.+)$/);
    if (!match) continue;
    if (normalizeName(match[1]) !== wanted) continue;
    const summary = cleanInline(match[2]);
    if (!summary) continue;
    return { summary, lang: hasChinese(summary) ? 'zh' : 'en' };
  }

  // 3) 小节标题：## name / ### `name`，取后面第一个段落（最多看 30 行）
  for (let i = 0; i < lines.length; i += 1) {
    const heading = lines[i].trim().match(/^#{1,4}\s+(.+)$/);
    if (!heading) continue;
    if (normalizeName(heading[1]) !== wanted) continue;
    for (let j = i + 1; j < Math.min(lines.length, i + 31); j += 1) {
      const para = lines[j].trim();
      if (!para) continue;
      if (para.startsWith('#') || para.startsWith('|') || para.startsWith('```')) break;
      const summary = cleanInline(para);
      if (summary) return { summary, lang: hasChinese(summary) ? 'zh' : 'en' };
      break;
    }
  }

  return null;
}

/** `https://github.com/owner/repo.git` → `{owner, repo}`；非 GitHub 返回 null。 */
export function parseGithubRepo(sourceUrl) {
  const match = /^https?:\/\/github\.com\/([^/]+)\/([^/?#]+?)(?:\.git)?\/?$/i.exec(String(sourceUrl || '').trim());
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

/** 候选 raw 文档：技能目录自带 README 优先，然后仓库根 README（中文版优先）。 */
export function rawCandidates(sourceUrl, skillPath) {
  const repo = parseGithubRepo(sourceUrl);
  if (!repo) return [];
  const files = [];
  const dir = typeof skillPath === 'string' && skillPath.includes('/') ? skillPath.slice(0, skillPath.lastIndexOf('/')) : '';
  if (dir) files.push(`${dir}/README.zh.md`, `${dir}/README.md`);
  files.push('README.zh.md', 'README.zh-CN.md', 'README_zh.md', 'README.md');
  const out = [];
  const seen = new Set();
  for (const file of files) {
    for (const branch of ['main', 'master']) {
      const url = `https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/${branch}/${file}`;
      if (seen.has(url)) continue;
      seen.add(url);
      out.push({ url, file, branch });
    }
  }
  return out;
}

/** 抓取一段文本（仅 GitHub raw），失败/超限返回 null。 */
export async function fetchGithubText(url, timeoutMs = FETCH_TIMEOUT_MS) {
  if (!/^https:\/\/raw\.githubusercontent\.com\//.test(String(url || ''))) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { accept: 'text/plain' } });
    if (!res || !res.ok) return null;
    const text = await res.text();
    if (!text || text.length > MAX_DOC_BYTES) return null;
    return text;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** 在安装源仓库里找该技能的中文简介；没有中文时回退返回英文候选。 */
export async function findSourceZh(install, name, options = {}) {
  const fetchText = typeof options.fetchText === 'function' ? options.fetchText : fetchGithubText;
  const candidates = rawCandidates(install && install.sourceUrl, install && install.skillPath);
  let english = null;
  for (const candidate of candidates) {
    const text = await fetchText(candidate.url);
    if (!text) continue;
    const hit = parseSkillMention(text, name);
    if (!hit) continue;
    const result = { file: candidate.file, url: candidate.url, branch: candidate.branch, summary: hit.summary, lang: hit.lang };
    if (hit.lang === 'zh') return result;
    if (!english) english = result;
  }
  return english;
}

export function sourceCacheKey(sourceUrl, name) {
  return `${sourceUrl}#${name}`;
}

export function readSourceCache() {
  const file = join(pluginDataDir(), CACHE_FILE);
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function writeSourceCache(cache) {
  try {
    atomicWriteJson(join(pluginDataDir(), CACHE_FILE), cache);
  } catch {
    /* 缓存写失败不影响主流程 */
  }
}

export function getCachedSource(cache, key) {
  const entry = cache && typeof cache === 'object' ? cache[key] : null;
  if (!entry || typeof entry !== 'object') return null;
  if (typeof entry.at !== 'number' || Date.now() - entry.at > CACHE_TTL_MS) return null;
  if (!entry.summary) return null;
  return entry;
}

export function setCachedSource(cache, key, entry) {
  if (!cache || typeof cache !== 'object') return cache;
  cache[key] = { ...entry, at: Date.now() };
  // 简单上限，避免缓存文件无限增长
  const keys = Object.keys(cache);
  if (keys.length > 500) {
    keys
      .sort((a, b) => (cache[a].at || 0) - (cache[b].at || 0))
      .slice(0, keys.length - 500)
      .forEach((key) => delete cache[key]);
  }
  return cache;
}
