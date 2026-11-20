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

The Pages workflow refreshes the nightly and beta build snapshot from the
official branch listings. To refresh it locally, run
`python3 -m scripts.build_nightly_data`. These lists cover published fixes in
the current listing window, not the entire build history.

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
