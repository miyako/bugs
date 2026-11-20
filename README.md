# 4D Fix Finder

A static, evidence-based checker for whether an ACI is fixed in a 4D release.
The checker uses official fix listings and verified release chronology to carry
older fixes forward across release lines.

## Run locally

Requirements: Python 3.9+ and Node.js 20.19+ (or 22.12+).

```sh
python3 scripts/build_data.py --max-pages 1
npm ci
npm run dev
```

The initial seed is the official 4D 21.2 Fixed Bugs List. The default crawl
limit is 200 pages; previously indexed official version pages are also seeded
so they are refreshed even when the current 21.2 link graph does not reach
them. Increase `--max-pages` for larger graphs, or provide additional
`--seed-url` arguments. Requests are sequential and rate-limited.
The crawler stores content-addressed HTML under `data/raw/` and writes the
browser dataset to `public/data/fixed-bugs.json`. Any page reached but failing
to parse or any non-404 fetch failure aborts the refresh. Official version
pages returning 404 remain explicitly incomplete; references not reached before
the page limit also remain incomplete and cannot produce a negative verdict.

## Data and verdict semantics

With just an ACI, the checker lists releases with explicit fix evidence and
the first indexed fix build on each nightly branch, or reports **NO DATA**
if neither index contains the ACI. Select a version to check its status or
enter a build number for that version's nightly branch.

- **YES** means the official source lists the ACI on that version or on an
  earlier release with a verified release date.
- **NO** means the complete historical dataset shows no fix on or before the
  requested release. A fix from a later release is never applied backward.
- **UNKNOWN** means the ACI, version, release chronology, or historical
  coverage is unavailable or incomplete. A complete target page alone cannot
  establish NO when older releases may contain a fix.
- Build numbers are a separate result. Without authoritative build mappings,
  a requested build is reported as UNKNOWN even when the version verdict is
  known. The build lookup assumes the number belongs to the selected release's
  nightly branch. A fix listed at or before that build on the same branch is
  **YES**; nightly evidence never changes a release-only verdict.
- If the earliest indexed fix on the branch is later than the requested build,
  the checker shows that build as a note alongside the verdict. With no build
  entered, the note uses a verified release build when available (`19.8`,
  `20.9`, `21.1`, `21.2`, or `21.2 HF2`). These mappings come from 4D installer
  pages or the official nightly list's named release baseline. A later listing
  does not prove that earlier builds were unfixed.

The Pages workflow merges current nightly and beta listings into the
`nightly-history` branch before deploying. It keeps entries that roll off the
official lists, with their source URL and earliest recorded UTC observation
date. This is not a complete build history. The checked-in snapshot seeds the
archive; records that predate observation tracking may lack a date.

Run `bash scripts/refresh_nightly_history.sh` to refresh locally using the
remote archive without publishing. To recover the last archived snapshot,
fetch `origin nightly-history` and read `git show FETCH_HEAD:nightly-fixes.json`.

Every verdict includes its source page and fetch date. A failed refresh cannot
replace the last deployed dataset.

## Development

```sh
npm test
npm run typecheck
npm run build
python3 -m unittest discover -s tests
```

The GitHub Pages workflow runs the bounded source refresh, checks, and static
deployment. The application does not require a runtime backend or account.
