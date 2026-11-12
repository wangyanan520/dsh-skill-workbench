// dsh-skill-workbench · 宿主侧通用工具（零构建，仅 node: 内建模块）
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_JSON_URL = new URL('../package.json', import.meta.url);
const BUILTIN_PACK_URL = new URL('../translations/zh-CN.builtin.json', import.meta.url);

let cachedVersion = null;

export function pluginVersion() {
  if (cachedVersion !== null) return cachedVersion;
  try {
    const parsed = JSON.parse(readFileSync(PACKAGE_JSON_URL, 'utf8'));
    cachedVersion = typeof parsed?.version === 'string' && parsed.version ? parsed.version : '0.1.0';
  } catch {
    cachedVersion = '0.1.0';
  }
  return cachedVersion;
}

export function dshHome() {
  const fromEnv = process.env.DSH_HOME;
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv.trim();
  return join(homedir(), '.dsh');
}

export function agentsHome() {
  const fromEnv = process.env.DSH_AGENTS_HOME;
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv.trim();
  return join(homedir(), '.agents');
}

export function pluginDataDir() {
  return join(dshHome(), 'dsh-skill-workbench');
}

export function userStorePath() {
  return join(pluginDataDir(), 'index.json');
}

export function diagnosticsPath() {
  return join(pluginDataDir(), 'diagnostics.json');
}

export function builtinPackPath() {
  return fileURLToPath(BUILTIN_PACK_URL);
}

export function sha256hex(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

export function nowIso() {
  return new Date().toISOString();
}

export function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function trimString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function getService(ctx, name) {
  if (!ctx) return undefined;
  try {
    if (typeof ctx.get === 'function') {
      const viaGet = ctx.get(name, false);
      if (viaGet !== undefined && viaGet !== null) return viaGet;
    }
  } catch {
    // cordis 服务未就绪时 get 可能抛错，降级到属性访问
  }
  try {
    const direct = ctx[name];
    if (direct !== undefined && direct !== null) return direct;
  } catch {
    // ignore
  }
  return undefined;
}

/** 从 cwd 向上找含 .git 的目录；找不到返回 cwd（对齐 dsh-skill-filesystem 的 findProjectRoot）。 */
export function findProjectRoot(cwd) {
  if (typeof cwd !== 'string' || cwd.trim() === '') return null;
  let current;
  try {
    current = resolve(cwd);
  } catch {
    return null;
  }
  const start = current;
  for (let depth = 0; depth < 64; depth += 1) {
    try {
      if (existsSync(join(current, '.git'))) return current;
    } catch {
      return start;
    }
    const parent = dirname(current);
    if (parent === current) return start;
    current = parent;
  }
  return start;
}

/**
 * 契约 §1.2：stripFrontmatter(s) 若以 "---\n"（或 "---\r\n"）开头，
 * 找到其后第一个独占一行的 "---"，返回其后的内容；否则原样返回。
 */
export function stripFrontmatter(source) {
  const text = String(source);
  let rest;
  if (text.startsWith('---\r\n')) rest = text.slice(5);
  else if (text.startsWith('---\n')) rest = text.slice(4);
  else return text;
  const match = /^---\r?$/m.exec(rest);
  if (!match) return text;
  return rest.slice(match.index + match[0].length);
}

export function hashFrontmatter(name, description) {
  return sha256hex(`${String(name).trim()}\n${String(description).trim()}`);
}

export function hashBody(content) {
  return sha256hex(stripFrontmatter(String(content)).trim());
}

/** 读取 JSON 文件：{status:'ok'|'missing'|'invalid', data?}，不抛错。 */
export function readJsonFile(file) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return { status: 'missing' };
    if (error && (error.code === 'EISDIR' || error.code === 'EACCES' || error.code === 'EPERM')) {
      return { status: 'invalid' };
    }
    return { status: 'invalid' };
  }
  try {
    return { status: 'ok', data: JSON.parse(text) };
  } catch {
    return { status: 'invalid' };
  }
}

/** 原子写 JSON（tmp + rename），失败清理 tmp 后抛出。 */
export function atomicWriteJson(file, data) {
  const tmp = `${file}.${Date.now().toString(36)}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    renameSync(tmp, file);
  } catch (error) {
    try {
      unlinkSync(tmp);
    } catch {
      // ignore cleanup failure
    }
    throw error;
  }
}

/** 规范化路由里的 cwd：只接受绝对路径；缺省时尝试 ctx.workingDirectory.get()（契约 §3）。 */
export function resolveCwd(ctx, provided) {
  if (typeof provided === 'string' && provided.trim() !== '') {
    const value = provided.trim();
    if (value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\')) {
      return resolve(value);
    }
  }
  try {
    const fromCtx = ctx?.workingDirectory?.get?.();
    if (typeof fromCtx === 'string' && fromCtx.trim() !== '') {
      const value = fromCtx.trim();
      if (value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\')) {
        return resolve(value);
      }
    }
  } catch {
    // ignore
  }
  return null;
}
