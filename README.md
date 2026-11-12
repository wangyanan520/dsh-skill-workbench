# dsh-skill-workbench

A Chinese display layer for [DSH](https://github.com/deepseek-ai) skills. When you invoke a skill from the `/` menu, entries are grouped by Chinese category and shown with a Chinese display name and summary — while the call token always stays the English `/name`, so model and host behaviour are unchanged.

- Never edits any `SKILL.md` and never fakes a Chinese skill name;
- Chinese data lives in `$DSH_HOME/dsh-skill-workbench/index.json` — sidecar only, lossless to uninstall;
- Ships a zh-CN display pack for 53 skills (45 user skills + 8 DSH built-ins), usable right after install;
- Management page: skill library / settings; rename a skill, edit its summary and category, and check translation coverage; "use original description" one-click for skills already written in Chinese;
- AI translation is **optional**: off by default; only called when you press "AI retranslate" and the host has a model configured;
- Saving writes **only the fields you actually changed** (built-in/project Chinese content is never copied wholesale into the user layer); an untranslated skill needs at least a Chinese name or summary to save; the detail page shows the Chinese source and lets you remove the user-layer override.

## Install

```powershell
dsh plugin --profile desktop add link:<path-to-this-repo>
```

Restart DSH (or click the refresh button in the top-right corner) and a "技能管理" (Skill Manager) entry appears in the sidebar. Uninstall:

```powershell
dsh plugin --profile desktop remove dsh-skill-workbench
```

Requires `@deepseek-ai/dsh >= 0.2.2-rc.1` and React 18.

## Layout

```
dsh-skill-workbench/
├─ index.js                 # host plugin entry (cordis)
├─ client.js                # browser side: / menu decoration + management page
├─ cordis.patch.yml         # inserts the plugin into the profile plugin table
├─ host/                    # host side: store, scanning, HTTP routes, translation, selftest
├─ translations/            # bundled zh-CN display pack + validator
├─ locale/                  # the plugin's own zh/en UI strings
├─ docs/
│  ├─ API-CONTRACT.md       # host HTTP API / data model / client behaviour contract
│  ├─ DESIGN.md             # design notes (problem, alternatives, interaction, AC)
│  └─ VERIFY.md             # delivery checklist and runtime evidence
└─ test/                    # real React render, / menu integration, edge cases
```

## Development

```powershell
node client.selftest.mjs        # 32 client assertion groups
node host/selftest.mjs          # 37 host checks
node translations/validate.mjs  # zh-CN pack completeness (53 entries)
```

Live tests need a running DSH app (default `http://127.0.0.1:51825`; override with `DSH_PLUGIN_ORIGIN`):

```powershell
$env:DSH_PLUGIN_ORIGIN='http://127.0.0.1:51999'
node test/run-live.mjs
```

## Naming

The DSH plugin market convention is an npm package named `dsh-*` (lowercase, hyphenated, e.g. `dsh-skill-groups`, `dsh-skills-hub`, `dsh-zh-layer`). This plugin uses `dsh-skill-workbench`: the `dsh-` prefix plus a functional description; the name was unclaimed on npm. Plugin id, API prefix, and storage directory all match it.

## 中文文档

See [README.zh.md](README.zh.md).

## License

MIT
