# @xmanrui/dsh-im — DSH 0.2.1-alpha.1 compatibility

- **Upstream:** https://github.com/xmanrui/dsh-im
- **Fork:** https://github.com/AEmbers/dsh-im
- **Version:** 4.34.2 → 4.34.3
- **Patched manifest:** `package.json`
- **Date:** 2026-10-04
- **Behaviour change:** none. This is a declaration/compatibility change only; no plugin logic was rewritten. The one code-adjacent edit is dropping a dead package name from a metadata list (see below).

## What changed

- `dsh.compatibility.dsh`: `"0.1.7-alpha.1"` → `">=0.2.0-rc.1"`.
- `dsh.compatibility.dshReleases`: was `{"0.1.7-alpha.1": "compatible"}`; now keeps that entry and adds `0.2.0-rc.1`, `0.2.0-rc.2`, `0.2.1-alpha.1` (all `"compatible"`).
- `engines.dsh` added: `">=0.2.0-rc.1"` (`engines.node` `>=22.19` untouched).
- `dsh.client.inject`: dropped `@deepseek-ai/dsh-client-runtime`.

## Why the dual-generation declaration

The Desktop host's bundled core is still **0.2.0-rc.2**, and a profile cannot upgrade the core on its own — the core comes from `app.asar`. Declaring only `0.2.1-alpha.1` would make the Desktop host reject the plugin outright for the whole transition period. So the window is declared as `>=0.2.0-rc.1` with both `0.2.0-rc.2` and `0.2.1-alpha.1` listed as `compatible`, which lets the same build run on either core.

## What the install gate actually reads

Worth recording, because it is not what the `dsh.compatibility` block suggests:

`dsh-app-boot`'s `evaluatePluginCompatibility()` (`lib/index.js:286-301`) only walks `peerDependencies` and only considers keys equal to `@deepseek-ai/dsh` or starting with `@deepseek-ai/dsh-`, testing each with `semver.satisfies(runtime, range, { includePrerelease: true })`. **`dsh.compatibility` / `dshReleases` are not consulted by the gate at all.** That is why these plugins were installable before this change; the `dshReleases` list is declaration-layer metadata for the plugin manager and tooling. Both layers were updated anyway.

## The dropped `@deepseek-ai/dsh-client-runtime` inject entry

Yes — this repo had the dead entry, and it is gone now (see the changes list above).

`@deepseek-ai/dsh-client-runtime` is a **stopped-publishing package name** — it was published historically (`npm view @deepseek-ai/dsh-client-runtime dist-tags` → `{ latest: '0.0.1-rc.1', next: '0.1.1-rc.2' }`) but has not shipped with the 0.2.x generation and is absent from the core `@deepseek-ai/dsh` dependency tree. It therefore has nothing to resolve to on either core.

It was removed from `dsh.client.inject` because that field is **informational only**: `dsh-client-modules` merely validates it as an array of strings (`optionalStringArray(pkgName, "dsh.client.inject", decl.inject)`), and `@deepseek-ai/dsh-client-ui-workspace/lib/client.js:4757` states outright that *"dsh.client.inject edges are informational"*. Byte-level check on `dsh-im/lib/client.js`: exactly one occurrence of the string, inside the package manifest inlined into the bundle, **with no `require()` of it anywhere**.

This is cleanup, not a 0.2.1 fix: the name never resolves on either core and its presence never mattered. **What actually gets this plugin through the install gate is the relaxed `peerDependencies` range — nothing else in this change does.** Do not read the removal of the inject entry as the compatibility fix.

## Verification

Both cores were verified independently, each with a purpose-built minimal profile (only `@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-web-app` + this batch's plugins, all linked to the **patched** working copies).

| Core | Sandbox root | Batch | Install gate | Boot | Client half |
|---|---|---|---|---|---|
| 0.2.1-alpha.1 | `C:\Sophia\_compat021` | pA-021c | ok | no errors | mounted (entries[].id present on both cores) |
| 0.2.0-rc.2 | `C:\Sophia\_compat020` | pA-020b | ok | no errors | mounted (entries[].id present on both cores) |

Commands (paths relative to this working copy):

```powershell
# fork + clone
gh repo fork xmanrui/dsh-im --clone=false
git clone https://github.com/AEmbers/dsh-im.git

# patch
cd C:\Sophia\_compat021\work
node _patch-pkg-text.mjs "package.json" --bump=patch

# install into the batch profile (one add at a time: a single rejection rolls back the whole batch)
$env:DSH_HOME = "C:\Sophia\_compat021\home"
node C:\Sophia\_compat021\node_modules\@deepseek-ai\dsh\lib\bin.js plugin --profile pA-021c add "link:C:/Sophia/_compat021/work/dsh-im"

# boot + probe
pwsh -NoProfile -File C:\Sophia\_compat021\work\run-all-batches.ps1 -Root C:\Sophia\_compat021 -Gen 021c -Seed seed021 -PortFrom 8930 -WorkRoot "C:\Sophia\_compat021\work"
```

Raw evidence: `C:\Sophia\_compat021\reports\`.

### Independent confirmation that the patched copy is what ran

Presence-and-version audit of the batch profiles (`Test-Path` + reading the installed `package.json`):

```
@xmanrui/dsh-im  batch=021c  exists=True  ver=4.34.3  want=4.34.3  OK  link=..\..\..\..\work\dsh-im
```

`pnpm-lock.yaml` records the same link, e.g.
`@xmanrui/dsh-im: specifier: link:C:/Sophia/_compat021/work/dsh-im`.

## Notes

- This is the one repo whose manifest declared a compatibility window at all — it declared **only** `0.1.7-alpha.1`, i.e. its `dshReleases` allow-list was two minor generations stale.
- `lib/index.js` and `lib/client.js` are both tracked, so no build-on-install step is required.

## How the host profile must be started (provenance)

`dsh web` only ever loads the profile literally named `web`; a `--profile` flag placed after the subcommand is a usage error (`dsh web --profile X` → `select a profile only once`, `dsh --profile X web` → `too many arguments`). The only accepted form is the global option before any subcommand:

```powershell
node <core>/lib/bin.js --profile <name> --no-open --port <port>
```

Every measurement behind this document used that form. Confirm the profile really carries the plugin before trusting a green result:

```powershell
$env:DSH_HOME = "C:\Sophia\_compat021\home"
node C:\Sophia\_compat021\node_modules\@deepseek-ai\dsh\lib\bin.js --profile pA-021c --dump-config |
  Select-String "auto-memory|modsearch|dsh-im|catgirl|my-guardian|tool-normalizer|whale"
```

Observed output included `# == @deepseek-ai/dsh-base, patched by @liustack/modsearch` and one `# == @xmanrui/dsh-im` block, i.e. the profile under test is the one carrying this package.

## Installing from GitHub

All nine forks were also installed the way a user would, from git, into a fresh third profile (all nine in one profile, added one at a time). Result: **9/9 installed, clean boot, same client-half verdicts.**

The exact spec verified for this package:

```text
github:AEmbers/dsh-im
```

```powershell
$env:DSH_HOME = "C:\Sophia\_compat021\home"
node <core>/lib/bin.js plugin --profile gittest add github:AEmbers/dsh-im
```

Observed: `exists=True, version=4.34.3` installed from a tarball (not a symlink) — i.e. the pushed commit is what ran, not the working copy.

Two packaging facts worth knowing when installing **from git**, neither of which this batch introduced:

1. **A git install runs only the `prepare` lifecycle script, not `prepack`/`prepublishOnly`.** Any package whose `main` lives in an ignored, uncommitted build directory will install "successfully" and then fail at boot.
2. **pnpm blocks `prepare` for git-hosted packages until the exact key is allow-listed — and the key is the whole specifier, not the package name.** Shortening it to `<name>: true` does nothing. This only came up for `my-dsh-plugins`, whose root declares a `prepare` script (`husky`).

   **How to obtain the exact key:** do **not** go through `dsh plugin add`. The `dsh plugin` diagnostics summary and `.plugin-manager/logs/operation-*/pnpm.log` both **omit** the required line, so searching them wastes time. Run pnpm itself and read its stdout:

   ```powershell
   cd <profile dir>              # e.g. C:\Sophia\_compat021\home\profiles\gittest
   pnpm add <git spec>           # prints the missive below on stdout
   ```

   pnpm then names the key verbatim, commit SHA included:

   ```
   [ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED] Failed to prepare git-hosted package fetched from
   "https://codeload.github.com/.../tar.gz/<sha>": ... is not in the "allowBuilds" allowlist.
   allowBuilds:
     <name>@https://codeload.github.com/<owner>/<repo>/tar.gz/<sha>: true
   ```

   Paste that line under `allowBuilds` in the profile's `pnpm-workspace.yaml` and re-run. Independently reproduced against a second, unrelated package on this team (`dsh-orb-cordis`), so treat the full-specifier form as the rule, not an accident.
3. **A monorepo whose root manifest has `"dependencies": { "<internal>": "file:plugins/<name>" }` cannot be installed as a whole from git**: the tarball does not contain the sibling directory, and pnpm fails with `ERR_PNPM_LINKED_PKG_DIR_NOT_FOUND: Could not install from "<profile>/plugins/dsh-shared" as it does not exist`. Installing the sub-package directly with the `#path:` form above avoids it (verified for `my-dsh-plugins` and for the `archify` sub-package, which is why the spec above has the shape it does).

## Not done / left alone

- No upstream pull request (out of scope for this batch).
- The sibling packages of the `my-dsh-plugins` monorepo and the non-DSH packages inside `archify/` were not touched.
- No plugin logic was rewritten; if a behaviour bug shows up on 0.2.1-alpha.1 later, it is not addressed here.
