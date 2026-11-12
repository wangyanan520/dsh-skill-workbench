// dsh-skill-workbench · 最小 YAML frontmatter 解析（只覆盖 SKILL.md 实际用到的子集）
import { stripFrontmatter, trimString } from './util.js';

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const KEY_RE = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/;
const BLOCK_SCALAR_RE = /^([|>])([-+]?)\s*$/;

function stripIndent(line) {
  return line.replace(/^\s+/, '').replace(/\s+$/, '');
}

function unquoteValue(raw) {
  const value = raw.trim();
  if (value === '') return '';
  const first = value[0];
  if (first === '"' || first === "'") {
    const quote = first;
    let end = -1;
    for (let index = 1; index < value.length; index += 1) {
      const char = value[index];
      if (char === '\\' && quote === '"') {
        index += 1;
        continue;
      }
      if (char === quote) {
        // YAML 单引号内用 '' 表示一个单引号，遇到成对引号跳过
        if (quote === "'" && value[index + 1] === "'") {
          index += 1;
          continue;
        }
        end = index;
        break;
      }
    }
    if (end !== -1) {
      const inner = value.slice(1, end);
      if (quote === '"') {
        return inner.replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\\\/g, '\\');
      }
      return inner.replace(/''/g, "'");
    }
  }
  return value;
}

function parseBoolean(raw) {
  const value = raw.trim().toLowerCase();
  if (value === 'true' || value === 'yes' || value === 'on' || value === '1') return true;
  if (value === 'false' || value === 'no' || value === 'off' || value === '0') return false;
  return undefined;
}

function collectBlockLines(lines, startIndex) {
  const collected = [];
  let index = startIndex;
  while (index < lines.length) {
    const line = lines[index];
    if (line.trim() === '') {
      collected.push('');
      index += 1;
      continue;
    }
    if (!/^\s/.test(line)) break;
    collected.push(line);
    index += 1;
  }
  // 去掉结尾空行
  while (collected.length > 0 && collected[collected.length - 1] === '') collected.pop();
  return { collected, nextIndex: index };
}

function renderBlockScalar(marker, lines) {
  if (lines.length === 0) return '';
  if (marker.startsWith('>')) {
    return lines.map((line) => stripIndent(line)).join(' ').replace(/\s+/g, ' ').trim();
  }
  return lines.map((line) => stripIndent(line)).join('\n').trim();
}

/** 解析 SKILL.md：返回 {frontmatter, body, hasFrontmatter}；解析失败时 frontmatter 至少包含空对象。 */
export function parseFrontmatter(content) {
  const text = String(content ?? '');
  const frontmatter = {};
  const match = FRONTMATTER_RE.exec(text);
  if (!match) {
    return { frontmatter, body: text.trim(), hasFrontmatter: false };
  }
  const block = match[1];
  const body = text.slice(match[0].length).trim();
  const lines = block.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === '') continue;
    if (/^\s/.test(line)) continue; // 已由块标量/嵌套结构消费的续行
    const kv = KEY_RE.exec(line);
    if (!kv) continue;
    const key = kv[1];
    const raw = kv[2];
    const blockScalarMatch = BLOCK_SCALAR_RE.exec(raw.trim());
    if (blockScalarMatch) {
      const { collected, nextIndex } = collectBlockLines(lines, index + 1);
      frontmatter[key] = renderBlockScalar(raw.trim(), collected);
      index = nextIndex - 1;
      continue;
    }
    if (raw.trim() === '') {
      // 嵌套结构（metadata: 等）不解析，跳过其缩进内容
      let nextIndex = index + 1;
      while (nextIndex < lines.length) {
        const nextLine = lines[nextIndex];
        if (nextLine.trim() === '' || /^\s/.test(nextLine)) {
          nextIndex += 1;
          continue;
        }
        break;
      }
      index = nextIndex - 1;
      frontmatter[key] = '';
      continue;
    }
    const unquoted = unquoteValue(raw);
    const asBool = parseBoolean(unquoted);
    frontmatter[key] = asBool === undefined ? unquoted : asBool;
  }
  return { frontmatter, body, hasFrontmatter: true };
}

export const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * 校验并提取技能元数据；name/description 不合法时返回 null（对齐官方 parseSkillFile 的硬性要求）。
 * 返回 {name, description, whenToUse, modelInvocable, userInvocable, body}
 */
export function parseSkillContent(content) {
  const parsed = parseFrontmatter(content);
  const name = trimString(parsed.frontmatter.name);
  const description = trimString(parsed.frontmatter.description);
  if (!name || !SKILL_NAME_RE.test(name) || !description) return null;
  const whenToUse = trimString(parsed.frontmatter.whenToUse);
  const modelInvocable = parsed.frontmatter['disable-model-invocation'] !== true;
  const userInvocable = parsed.frontmatter['user-invocable'] !== false;
  return {
    name,
    description,
    whenToUse: whenToUse || null,
    modelInvocable,
    userInvocable,
    body: stripFrontmatter(content).trim(),
  };
}
