// 页面回归的离线夹具：在临时目录里造一套确定的技能根与用户层中文条目。
//
// 为什么需要它：原先 /list 载荷由 host/scan.js 直接扫本机技能目录生成，
// 于是出现两个问题——CI 没有 ~/.agents/skills 时一条技能都扫不到，
// 测试崩在 rows()[0]；而断言又依赖本机装了什么，无法当门禁用。
//
// 这里改为：文件系统是真的（SKILL.md、index.json 都真写盘），扫描也走真实的
// host/scan.js，只是根目录被 DSH_HOME / DSH_AGENTS_HOME 指到临时目录。
// 这样既覆盖了「扫描 → 合并层级 → 生成 SkillView」的真实链路，
// 又保证任何机器、任何 CI 上结果完全一致。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanSkills } from '../host/scan.js';

// 内置包是仓库里的真实文件；用它推导「哪些夹具技能命中内置层」，
// 既不依赖本机技能目录，也不把 53 条包内容抄进测试。
const BUILTIN_PACK = JSON.parse(
  fs.readFileSync(new URL('../translations/zh-CN.builtin.json', import.meta.url), 'utf8'),
);

/** 夹具里故意造过期状态的技能（用户层 hash 与当前文件不一致）。 */
const STALE_NAMES = ['lark-doc'];

/**
 * 夹具里的技能：4 个用户层（3 个中文条目 + 1 个命中内置包）、
 * 1 个用户层无中文、1 个项目层。 */
const SKILL_FILES = [
  {
    dir: 'lark-doc',
    kind: 'user',
    content: [
      '---',
      'name: lark-doc',
      'description: Read, create and edit Lark documents. Use when the user asks about docs, wiki pages or exporting a document.',
      'whenToUse: 需要读写飞书文档或导出文档时。',
      '---',
      '',
      '# lark-doc',
      '',
      'Doc operations for Lark.',
      '',
    ].join('\n'),
  },
  {
    dir: 'lark-base',
    kind: 'user',
    content: [
      '---',
      'name: lark-base',
      'description: Query and edit Lark Base tables and records. Use for multi-dimensional tables, fields and views.',
      'whenToUse: 需要查改飞书多维表格或多维表格记录时。',
      '---',
      '',
      '# lark-base',
      '',
      'Base operations.',
      '',
    ].join('\n'),
  },
  {
    dir: 'lark-im',
    kind: 'user',
    content: [
      '---',
      'name: lark-im',
      'description: Send and read Lark messages and chats. Use when the user asks to notify a group or read a conversation.',
      'whenToUse: 需要收发飞书消息时。',
      '---',
      '',
      '# lark-im',
      '',
      'Messaging operations.',
      '',
    ].join('\n'),
  },
  {
    dir: 'agent-reach',
    kind: 'user',
    // 没有用户层中文条目，只有仓库内置包里的「全网调研」：用来覆盖 builtin 桶。
    content: [
      '---',
      'name: agent-reach',
      'description: Research a topic across 15 platforms. Use when the user asks for research or shares a platform URL.',
      'whenToUse: Research a topic across platforms or read a shared URL.',
      '---',
      '',
      '# agent-reach',
      '',
      'Cross-platform research.',
      '',
    ].join('\n'),
  },
  {
    dir: 'plain-notes',
    kind: 'user',
    // 原文本身就是中文的技能：真实环境里 51 条中有 33 条属于这种情况。
    content: [
      '---',
      'name: plain-notes',
      'description: 读写本地纯文本笔记，按标签整理。',
      'whenToUse: 需要整理零散笔记时。',
      '---',
      '',
      '# plain-notes',
      '',
      '本地笔记。',
      '',
    ].join('\n'),
  },
  {
    dir: 'project-only',
    kind: 'project',
    content: [
      '---',
      'name: project-only',
      'description: Project-scoped helper that only exists inside this repository.',
      'whenToUse: 仅在本项目内使用。',
      '---',
      '',
      '# project-only',
      '',
      'Project scoped.',
      '',
    ].join('\n'),
  },
];

/** 用户层中文条目：给 3 个 lark 技能配中文名、拼音与首字母；agent-reach 走内置包。 */
const USER_ENTRIES = {
  'lark-doc': {
    // 故意写一个与当前 SKILL.md 不一致的 hash：覆盖卡的「过期」桶需要一条 stale。
    hash: { frontmatter: 'fixture-stale-lark-doc' },
    zh: {
      name: '飞书云文档',
      summary: '读写飞书文档、知识库页面与文档导出。',
      description: '覆盖飞书文档的创建、读取、编辑与导出，含知识库页面。',
      whenToUse: '需要读写飞书文档时。',
      notFor: '不处理多维表格，那属于 lark-base。',
      category: 'lark',
      tags: ['文档', '知识库'],
      pinyin: 'feishu yunwendang',
      pinyinInitials: 'fsywd',
      origin: 'manual',
      review: 'reviewed',
    },
    updatedAt: '2026-11-16T08:00:00.000Z',
  },
  'lark-base': {
    zh: {
      name: '多维表格',
      summary: '增删改查飞书多维表格的表、字段、视图与记录。',
      category: 'lark',
      tags: ['多维表格'],
      pinyin: 'feishu duoweibiaoge',
      pinyinInitials: 'dwbg',
      origin: 'manual',
      review: 'reviewed',
    },
    updatedAt: '2026-11-16T08:00:00.000Z',
  },
  'lark-im': {
    zh: {
      name: '飞书消息',
      summary: '收发飞书消息、读会话、给群发通知。',
      category: 'lark',
      pinyin: 'feishu xiaoxi',
      pinyinInitials: 'fsxx',
      origin: 'manual',
      // 故意留一条草稿：覆盖卡与「未审核」筛选需要它。
      review: 'draft',
    },
    updatedAt: '2026-11-16T08:00:00.000Z',
  },
};

const STORE_FILE = {
  schemaVersion: 1,
  lang: 'zh-CN',
  updatedAt: '2026-11-16T08:00:00.000Z',
  settings: {},
  categories: [
    { id: 'lark', zh: '飞书', order: 10 },
    { id: 'notes', zh: '笔记', order: 20 },
  ],
  entries: USER_ENTRIES,
};

const BUILTIN_NAMES = SKILL_FILES.map((skill) => skill.dir).filter((name) => {
  const entry = BUILTIN_PACK.entries && BUILTIN_PACK.entries[name];
  return Boolean(entry && entry.zh && Object.keys(entry.zh).length > 0);
});
const LOCAL_NAMES = Object.keys(USER_ENTRIES).filter((name) => !BUILTIN_NAMES.includes(name));
const NONE_NAMES = SKILL_FILES.map((skill) => skill.dir).filter(
  (name) => !BUILTIN_NAMES.includes(name) && !LOCAL_NAMES.includes(name),
);
const BUCKETS = Object.freeze({
  builtin: BUILTIN_NAMES.length,
  local: LOCAL_NAMES.length,
  none: NONE_NAMES.length,
  // 夹具的 layers 完整，因此没有来源未知；客户端遇到缺 layers 的旧宿主才会计入 unknown。
  unknown: 0,
  stale: STALE_NAMES.length,
  draft: Object.values(USER_ENTRIES).filter((entry) => entry.zh.review === 'draft').length,
  total: SKILL_FILES.length,
});

/** 夹具的确定事实，供测试断言；扫描结果与它不一致说明链路坏了，而不是环境不同。 */
export const FIXTURE = Object.freeze({
  total: BUCKETS.total,
  cjkTotal: BUCKETS.builtin + BUCKETS.local,
  larkTotal: SKILL_FILES.filter((skill) => skill.dir.startsWith('lark-')).length,
  draftTotal: BUCKETS.draft,
  buckets: BUCKETS,
  names: SKILL_FILES.map((skill) => skill.dir),
});

function writeSkill(root, skill) {
  const dir = path.join(root, skill.dir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), skill.content, 'utf8');
}

/**
 * 造夹具并扫描。
 * 返回 { payload, scanned, root, cleanup }；payload 就是宿主 /list 的响应体形状。
 * 注意：会把 DSH_HOME / DSH_AGENTS_HOME 指向临时目录，调用方应在结束前 cleanup()。
 */
export async function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skw-fixture-'));
  const dshHome = path.join(root, 'dsh');
  const agentsHome = path.join(root, 'agents');
  const projectRoot = path.join(root, 'project');

  const agentsSkills = path.join(agentsHome, 'skills');
  const projectSkills = path.join(projectRoot, '.dsh', 'skills');
  const storeDir = path.join(dshHome, 'dsh-skill-workbench');
  fs.mkdirSync(agentsSkills, { recursive: true });
  fs.mkdirSync(projectSkills, { recursive: true });
  fs.mkdirSync(storeDir, { recursive: true });

  for (const skill of SKILL_FILES) {
    if (skill.kind === 'project') writeSkill(projectSkills, skill);
    else writeSkill(agentsSkills, skill);
  }
  fs.writeFileSync(path.join(storeDir, 'index.json'), JSON.stringify(STORE_FILE, null, 2), 'utf8');

  const previous = {
    DSH_HOME: process.env.DSH_HOME,
    DSH_AGENTS_HOME: process.env.DSH_AGENTS_HOME,
  };
  process.env.DSH_HOME = dshHome;
  process.env.DSH_AGENTS_HOME = agentsHome;

  const cleanup = () => {
    for (const key of Object.keys(previous)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    fs.rmSync(root, { recursive: true, force: true });
  };

  let scanned;
  try {
    // cwd 指到临时项目根：向上找不到 .git，findProjectRoot 就返回它自己，
    // 于是项目层只可能是这里的 .dsh/skills，不会读到本仓库或其他目录。
    scanned = await scanSkills({}, { cwd: projectRoot });
  } catch (error) {
    cleanup();
    throw error;
  }

  return {
    root,
    payload: {
      skills: scanned.skills,
      categories: scanned.stores.userStore.categories,
      coverage: scanned.coverage,
      generatedAt: scanned.generatedAt,
      settings: {},
      store: {},
    },
    scanned,
    cleanup,
  };
}
