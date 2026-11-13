# dsh-skill-workbench

DSH's skill catalog is written in English. If you work in Chinese, the `/` menu becomes a list of English names you decode every time. This plugin puts a Chinese layer on top: skills are grouped under Chinese categories and shown with a Chinese name and summary. The token you send is still the English `/name`, so the model, the host and every skill file behave as before.

It also gives you a page to edit those labels: rename a skill, rewrite its summary, move it to another category, see which skills still have no Chinese entry. For skills installed from a GitHub repo it can read that repo's README and fill in a summary. Personal skills can be uninstalled into a recycle bin instead of disappearing.

## Install

### Community plugin marketplace

Once the listing is merged into the community catalog, open DSH's plugin market and search for `dsh-skill-workbench`. Install it from there and restart DSH.

### Custom plugin index

If you don't want to wait for the listing, add the index by hand:

1. DSH → Plugins → Experimental plugins → enable **Custom plugin indexes**
2. Open **Discover** and add
   `https://raw.githubusercontent.com/wangyanan520/dsh-skill-workbench/main/market/index.json`
3. Install 技能管理 and restart DSH

### npm

```bash
dsh plugin --profile desktop add dsh-skill-workbench
```

### From a local checkout

```bash
dsh plugin --profile desktop add link:<path-to-this-repo>
```

Restart DSH, or hit the refresh button in the top right corner. A 技能管理 entry shows up in the sidebar. To remove the plugin:

```bash
dsh plugin --profile desktop remove dsh-skill-workbench
```

Needs DSH `>=0.2.2-rc.1`, Node 24 and React 18.

## What you get

### The `/` menu

Skills keep their English invocation token and get a Chinese display name, a one-line summary and a Chinese category. Recent skills sit at the top, then the categories, then skills that still have no translation. The search box matches Chinese names, English names, aliases and pinyin, including initials (`qwdy` finds 全网调研).

Two menu modes exist. The default **decorate** mode rewrites the rows inside the official skill group and adds no group of its own. **Overlay** mode keeps the English group untouched and appends a separate 技能 group; it is a fallback for hosts where decoration doesn't take effect. A third mode turns the menu layer off and leaves only the management page.

### The management page

The library lists every skill with its translation status: translated, draft, stale (the original description changed), or untranslated. The detail view is where you edit the Chinese name, summary, category and tags, see whether the entry came from the bundled pack or from you, and drop your override to fall back to the bundled one. Skills whose description is already Chinese can reuse it with one click.

A coverage counter at the top of the library tells you how many skills are translated, drafted or stale. The settings page holds the menu mode, pinyin search, recent skills and the recycle bin.

### Summaries from the install source

Skills installed from GitHub usually have a Chinese README. The detail view can fetch the README of the repo recorded in `~/.agents/.skill-lock.json` and offer a summary from it; Chinese content wins, English is used with a note when nothing else exists. The result is cached for seven days and stays editable before you save it. The library toolbar has the same thing in bulk: it fills empty fields only, marks the entries as imported drafts, and never overwrites text you already wrote.

### Uninstall with a recycle bin

Removing a personal skill from `~/.agents/skills` moves the folder into the plugin's trash instead of deleting it. The settings page can restore it or delete it for good after a second confirmation. Project skills and DSH built-ins are read-only here, and the install record in `.skill-lock.json` is cleaned up for the removed skill.

### AI retranslation, optional

The detail view has an "AI retranslate" button. It calls the host's configured model only when you press it; with no model configured nothing happens. You can also leave it alone entirely and write the labels yourself.

## Where the data lives

- `$DSH_HOME/dsh-skill-workbench/index.json` — your Chinese entries, settings and the bundled pack pointer
- `<project>/.dsh/skill-cn/zh-index.json` — optional per-project labels, merged over the user layer
- `$DSH_HOME/dsh-skill-workbench/trash/` — skills moved out of `~/.agents/skills`
- `$DSH_HOME/dsh-skill-workbench/diagnostics.json` — last scan diagnostics

`$DSH_HOME` defaults to `~/.dsh`. Removing the plugin or its data folder leaves every `SKILL.md` untouched and every skill working; the only loss is the Chinese labels.

## Permissions

The plugin reads the skill roots of the current project and the user profile. It writes only inside `$DSH_HOME/dsh-skill-workbench/` and, when you uninstall a personal skill, inside `~/.agents/skills` and `~/.agents/.skill-lock.json`. It does not edit `SKILL.md` files, and it does not touch skills it doesn't own.

The host HTTP API listens on loopback and checks the request origin. The only outbound request is the README fetch from GitHub for the install-source feature; everything else works offline.

## Known limitations

- The bundled display pack covers 53 skills. A different set of installed skills means partial coverage at first; fill the gaps by hand or from install sources.
- Translation happens per skill. There is no bulk-translate button yet.
- Overlay mode shows two groups on purpose. If both groups appear and you only wanted one, switch back to decorate mode.
- The Chinese layer changes what you see, not what the model receives. Skill descriptions sent to the model remain the original English ones.

## Development

```bash
node client.selftest.mjs        # client assertions against a real React render
node host/selftest.mjs          # host checks; CI sets SKIP_REAL_AGENTS_SCAN=1
node translations/validate.mjs  # bundled pack completeness
```

Live tests need a running DSH app on `http://127.0.0.1:51825` (override with `DSH_PLUGIN_ORIGIN`):

```bash
DSH_PLUGIN_ORIGIN='http://127.0.0.1:51999' node test/run-live.mjs
```

Release steps and the marketplace submission are documented in [docs/PUBLISH.md](docs/PUBLISH.md). The host API contract is in [docs/API-CONTRACT.md](docs/API-CONTRACT.md); design notes are in [docs/DESIGN.md](docs/DESIGN.md).

## 中文文档

见 [README.zh.md](README.zh.md)。

## License

MIT
