# 4D Fix Finder

A static, evidence-based checker for whether an ACI is listed as fixed in a
specific 4D release. The checker uses only explicit official-list evidence:
release-number ordering never implies that a fix exists on another release
line.

## Run locally

Requirements: Python 3.9+ and Node.js 20.19+ (or 22.12+).

```sh
python3 scripts/build_data.py --max-pages 1
npm ci
npm run dev
```

The initial seed is the official 4D 21.2 Fixed Bugs List. Increase
`--max-pages` to follow more official “Fixed also with” pages, or provide
additional `--seed-url` arguments. Requests are sequential and rate-limited.
The crawler stores content-addressed HTML under `data/raw/` and writes the
browser dataset to `public/data/fixed-bugs.json`. Any page reached but failing
to fetch or parse aborts the refresh; references not reached before the page
limit remain marked incomplete and cannot produce a negative verdict.

## Data and verdict semantics

- **YES** means the official source explicitly lists the ACI on that version or
  links it as “Fixed also with” that version.
- **NO** means the ACI is absent from a successfully fetched and parsed page
  for that exact version.
- **UNKNOWN** means the ACI, version, or source evidence is unavailable or
  incomplete. An absent ACI on an unindexed page is never treated as NO.
- Build numbers are a separate result. Without authoritative build mappings,
  a requested build is reported as UNKNOWN even when the version verdict is
  known.

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
