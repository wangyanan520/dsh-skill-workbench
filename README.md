# dsh-skill-workbench (技能管理)

A Chinese display layer for [DSH](https://github.com/deepseek-ai) skills. When you invoke a skill from the `/` menu, entries are grouped by Chinese category and shown with a Chinese display name and summary — while the call token always stays the English `/name`, so model and host behaviour are unchanged.

- Never edits any `SKILL.md` and never fakes a Chinese skill name;
- Chinese data lives in `$DSH_HOME/dsh-skill-workbench/index.json` — sidecar only, lossless to uninstall;
- Ships a zh-CN display pack for 53 skills (45 user skills + 8 DSH built-ins), usable right after install;
- Management page: skill library / settings; rename a skill, edit its summary and category, and check translation coverage; "use original description" one-click for skills already written in Chinese;
- AI translation is **optional**: off by default; only called when you press "AI retranslate" and the host has a model configured;
- Saving writes **only the fields you actually changed** (built-in/project Chinese content is never copied wholesale into the user layer); an untranslated skill needs at least a Chinese name or summary to save; the detail page shows the Chinese source and lets you remove the user-layer override.
- The detail page can fill a summary from the skill's install source: the GitHub repo recorded at install time (`~/.agents/.skill-lock.json`). Chinese READMEs are preferred; when only English exists it is filled with a hint. Results are cached for 7 days and can be edited before saving.
- The library toolbar offers "Fill from install source": batch-read README summaries for untranslated personal skills (empty fields only, marked "imported / draft", editable afterwards).
- The detail page can uninstall personal skills from `~/.agents/skills`: the skill folder moves to a recycle bin first, where it can be restored or deleted permanently (two-step confirmation). Project skills and DSH built-ins stay read-only, and the install record is cleaned up.

## Install

### 1. Plugin market index (recommended for users)

1. DSH → **Plugins**
2. Under **Experimental plugins**, enable **Custom plugin indexes**
3. Open **Discover** and add the index URL:
   `https://raw.githubusercontent.com/wangyanan520/dsh-skill-workbench/main/market/index.json`
4. Find "技能管理" → install → restart DSH

### 2. npm

```bash
dsh plugin --profile desktop add dsh-skill-workbench
```

### 3. Local development

```bash
dsh plugin --profile desktop add link:<path-to-this-repo>
```

Restart DSH (or click the refresh button in the top-right corner) and a "技能管理" entry appears in the sidebar. Uninstall:

```bash
dsh plugin --profile desktop remove dsh-skill-workbench
```

Requires `@deepseek-ai/dsh >= 0.2.2-rc.1`, Node 24 and React 18.

## Relationship to skills-manager

- **skills-manager** loads/enables skills and manages their sources;
- **this plugin** owns the Chinese display layer (Chinese names, categories, summaries in the `/` menu) plus uninstalling personal skills into a recycle bin.
  Both can be installed together; they live in different entry points (settings vs sidebar). If you only want Chinese menu labels, this plugin is enough.

## Permissions and data

- Reads skill folders, **never writes** `SKILL.md`;
- Writes `$DSH_HOME/dsh-skill-workbench/`: Chinese index, recycle bin, install-source cache;
- Uninstalling a personal skill touches `~/.agents/skills` and `~/.agents/.skill-lock.json` (only for that skill);
- The host HTTP API listens on loopback only and validates local origin;
- Only "fill summary from install source" reaches GitHub raw content; everything else stays offline.

## Known limitations

- The bundled display pack is generated for a fixed set of 53 skills; machines with a different skill set will see coverage drift. Fill the gaps manually or from the install source.
- There is no bulk-translate UI yet (the host API supports it); only per-skill "AI retranslate" is exposed.
- The overlay compatibility mode intentionally renders two groups (official English group + the Chinese "技能" group).

## Layout

```
dsh-skill-workbench/
├─ index.js                 # host plugin entry (cordis)
├─ client.js                # browser side: / menu decoration + management page
├─ cordis.patch.yml         # inserts the plugin into the profile plugin table
├─ host/                    # host side: store, scanning, HTTP routes, translation, uninstall, install source
├─ translations/            # bundled zh-CN display pack + validator
├─ locale/                  # the plugin's own zh/en UI strings
├─ assets/icon.svg          # plugin icon
├─ market/                  # plugin market index (format 1)
├─ scripts/                 # market index generator
├─ docs/
│  ├─ API-CONTRACT.md       # host HTTP API / data model / client behaviour contract
│  ├─ DESIGN.md             # design notes (problem, alternatives, interaction, AC)
│  ├─ PUBLISH.md            # npm publish and market index checklist
│  └─ VERIFY.md             # delivery checklist and runtime evidence
└─ test/                    # real React render, / menu integration, edge cases
```

## Development

```bash
node client.selftest.mjs        # 32 client assertion groups
node host/selftest.mjs          # host checks; CI uses SKIP_REAL_AGENTS_SCAN=1
node translations/validate.mjs  # zh-CN pack completeness (against the bundled 53)
```

Live tests need a running DSH app (default `http://127.0.0.1:51825`; override with `DSH_PLUGIN_ORIGIN`):

```bash
DSH_PLUGIN_ORIGIN='http://127.0.0.1:51999' node test/run-live.mjs
```

Publishing steps: [docs/PUBLISH.md](docs/PUBLISH.md).

## Naming

Community DSH plugins use lowercase hyphenated npm names (e.g. `dsh-skill-groups`, `dsh-skills-hub`, `dsh-zh-layer`). This plugin uses `dsh-skill-workbench`: the `dsh-` prefix plus a functional description; the name was unclaimed on npm. Plugin id, API prefix, and storage directory all match it.

## 中文文档

See [README.zh.md](README.zh.md).

## License

MIT
