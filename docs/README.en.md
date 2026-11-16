# dsh-skill-workbench (English summary)

> Short English summary only. The Chinese [README.md](../README.md) is the source of
> truth; section-by-section duplication is avoided on purpose so this file cannot drift.

A display layer for DSH skill catalogs. DSH lists skills under English names; this
plugin groups them under Chinese categories and shows a Chinese name and a one-line
summary in the `/` menu. The invocation token stays the English `/name`, so the
model, the host and every `SKILL.md` behave exactly as before — no skill file is
ever modified, Chinese data lives in a sidecar store under `$DSH_HOME`.

It also ships a management page: rename skills, rewrite summaries, change
categories, see which skills still lack a Chinese entry, pull summaries from a
skill's install source, AI-retranslate on demand, and uninstall personal skills
into a recycle bin instead of deleting them.

## Install

- **Plugin marketplace**: search `dsh-skill-workbench` in DSH's plugin market, then restart DSH.
- **Custom index**: add
  `https://raw.githubusercontent.com/wangyanan520/dsh-skill-workbench/main/market/index.json`
  under Plugins → Experimental plugins → Custom plugin indexes, then install and restart.
- **npm**: `npm i dsh-skill-workbench`
- Requires DSH `>=0.2.2-rc.1`, Node 24, React 18.

## Docs

- Chinese README (full, authoritative): [../README.md](../README.md)
- Host HTTP contract: [API-CONTRACT.md](./API-CONTRACT.md)
- Design notes: [DESIGN.md](./DESIGN.md)
- Publishing and marketplace submission: [PUBLISH.md](./PUBLISH.md)

MIT licensed.
