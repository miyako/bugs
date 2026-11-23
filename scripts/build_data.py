#!/usr/bin/env python3
"""Fetch official 4D fixed-bug pages and generate the static browser dataset."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
RAW_DIR = DATA_DIR / "raw" / "sha256"
OUTPUT = ROOT / "public" / "data" / "fixed-bugs.json"
DEFAULT_SEED = "https://developer.4d.com/FixedBugsList/versions/21.2/"
HISTORICAL_RELEASE_SEEDS = ("19", "19.1", "19.2", "19.3", "19.4")
DEFAULT_MAX_PAGES = 200
HOST = "developer.4d.com"
USER_AGENT = "4D-Fix-Finder/0.1 (+https://github.com/miyako/bugs)"
ACI_PATTERN = re.compile(r"^ACI\d{7}$", re.IGNORECASE)
VERSION_PATTERN = re.compile(r"^(?P<major>\d+)(?:\.(?P<minor>\d+))?(?:_R(?P<r>\d+))?(?:_HF(?P<hf>\d+))?$", re.IGNORECASE)
LIFECYCLE_URL = "https://eu-en.4d.com/product-release-life-cycle"
INSTALLER_CREATED_DATES = {
    "19.1": "2021-11-30",
    "19.2": "2022-03-04",
    "19.3": "2022-05-23",
    "19.4": "2022-09-09",
}
RELEASE_DATES = {
    "18.6": "2022-06-13",
    "19": "2021-07-12",
    "19.8": "2024-07-11",
    "20": "2023-07-10",
    "20_R8": "2025-04-16",
    "20_R9": "2025-07-08",
    "20_R10": "2025-10-07",
    "20.8": "2025-11-06",
    "20.8_HF3": "2026-06-05",
    "20.8_HF4": "2026-08-20",
    "20.9": "2026-09-23",
    "21": "2026-01-13",
    "21_R2": "2026-04-21",
    "21_R2_HF2": "2026-06-18",
    "21.1": "2026-05-20",
    "21.1_HF1": "2026-06-26",
    "21.1_HF2": "2026-08-19",
    "21_R3": "2026-07-07",
    "21_R3_HF1": "2026-08-17",
    "21_R3_HF2": "2026-09-09",
    "21.2": "2026-09-07",
    "21_R4": "2026-10-12",
}
RELEASE_DATE_SOURCES = {
    "19": "https://blog.4d.com/4d-v19-is-here/",
    "20_R8": "https://blog.4d.com/4d-20-r8-is-here/",
    "20_R9": "https://blog.4d.com/4d-20-r9-is-here/",
    "20_R10": "https://blog.4d.com/4d-20-r10-is-here/",
    "20.8": "https://ch-fr.4d.com/4d-208-lts",
    "20.8_HF3": "https://github.com/4d/4D_Info_Report/releases/tag/4.98.2",
    "20.8_HF4": "https://github.com/4d/4D_Info_Report/releases/tag/4.98.2",
    "20.9": "https://us.4d.com/product-download/4D-20-LTS",
    "21": "https://blog.4d.com/4d-21-lts-is-here/",
    "21_R2": "https://blog.4d.com/4d-21-r2-is-here/",
    "21_R2_HF2": "https://github.com/4d/4D_Info_Report/releases/tag/4.98.2",
    "21.1": "https://es.4d.com/211-lts",
    "21.1_HF1": "https://github.com/4d/4D_Info_Report/releases/tag/4.98.2",
    "21.1_HF2": "https://github.com/4d/4D_Info_Report/releases/tag/4.98.1",
    "21_R3": "https://blog.4d.com/4d-21-r3-is-here/",
    "21_R3_HF1": "https://github.com/4d/4D_Info_Report/releases/tag/4.98.1",
    "21_R3_HF2": "https://github.com/4d/4D_Info_Report/releases/tag/4.98.2",
    "21.2": "https://eu-en.4d.com/4d-212-lts",
    "21_R4": "https://blog.4d.com/4d-21-r4-is-here/",
}


@dataclass
class Cell:
    text: list[str] = field(default_factory=list)
    links: list[tuple[str, str]] = field(default_factory=list)


class FixedBugsPageParser(HTMLParser):
    """Extract the table rows and linked fix targets without regexing HTML."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.in_list_table = False
        self.row: list[Cell] | None = None
        self.cell: Cell | None = None
        self.rows: list[list[Cell]] = []
        self.active_link: tuple[str, list[str]] | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        classes = (attributes.get("class") or "").split()
        if tag == "table" and "list" in classes:
            self.in_list_table = True
        elif self.in_list_table and tag == "tr":
            self.row = []
        elif self.in_list_table and tag in {"td", "th"}:
            self.cell = Cell()
        elif self.in_list_table and tag == "a" and self.cell is not None:
            self.active_link = (attributes.get("href") or "", [])

    def handle_data(self, data: str) -> None:
        if self.cell is None:
            return
        text = " ".join(data.split())
        if text:
            self.cell.text.append(text)
            if self.active_link is not None:
                self.active_link[1].append(text)

    def handle_endtag(self, tag: str) -> None:
        if self.in_list_table and tag == "a" and self.active_link is not None:
            href, text = self.active_link
            if self.cell is not None and href:
                self.cell.links.append((href, " ".join(text).strip()))
            self.active_link = None
        elif self.in_list_table and tag in {"td", "th"} and self.cell is not None:
            if self.row is not None:
                self.row.append(self.cell)
            self.cell = None
        elif self.in_list_table and tag == "tr":
            if self.row is not None and self.row:
                self.rows.append(self.row)
            self.row = None
        elif tag == "table" and self.in_list_table:
            self.in_list_table = False


def version_from_url(url: str) -> dict[str, object]:
    path = urlparse(url).path.rstrip("/")
    slug = path.rsplit("/", 1)[-1]
    match = VERSION_PATTERN.fullmatch(slug)
    if not match:
        raise ValueError(f"Unrecognized version slug in source URL: {url}")
    major = int(match.group("major"))
    feature = match.group("r")
    minor = int(feature or match.group("minor") or 0)
    hotfix = int(match.group("hf") or 0)
    line = "R" if feature else "LTS"
    key = slug
    label = f"{major} R{minor}" if feature else (f"{major}.{minor}" if minor else str(major))
    if hotfix:
        label += f" HF{hotfix}"
    if line == "LTS" and not feature:
        label += " LTS"
    version = {
        "versionKey": key,
        "displayName": label,
        "major": major,
        "line": line,
        "minor": minor,
        "hotfix": hotfix,
        "kind": "release",
        "branchId": f"{major}-{line}" if line == "LTS" else f"{major}-R{minor}",
        "officialSlug": slug,
        "sourceUrl": url,
    }
    release_date = RELEASE_DATES.get(key)
    date_source = RELEASE_DATE_SOURCES.get(key, LIFECYCLE_URL)
    version["releasedAt"] = release_date
    version["releaseDateSource"] = date_source if release_date else None
    if key in INSTALLER_CREATED_DATES:
        version["installerCreatedAt"] = INSTALLER_CREATED_DATES[key]
        version["installerDateSource"] = (
            "https://product-download.4d.com/"
            f"?branch=19.x&flag=lts-release&type=installer&version_number={key}"
        )
    return version


def version_seed_urls(versions: list[dict[str, object]]) -> list[str]:
    seeds: list[str] = []
    for version in versions:
        slug = version.get("officialSlug")
        if not isinstance(slug, str) or not VERSION_PATTERN.fullmatch(slug):
            raise ValueError(f"Invalid official version slug in existing dataset: {slug!r}")
        seeds.append(f"https://{HOST}/FixedBugsList/versions/{slug}/")
    return seeds


def read_database(path: Path) -> dict[str, object]:
    try:
        database = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"Could not read dataset from {path}: {error}") from error
    if not isinstance(database, dict) or not isinstance(database.get("versions"), list):
        raise ValueError(f"Dataset has no version list: {path}")
    return database


def existing_version_seeds() -> list[str]:
    return version_seed_urls(read_database(OUTPUT)["versions"]) if OUTPUT.exists() else []


def parse_page(html: str, page_url: str, content_hash: str) -> tuple[dict[str, str], list[dict[str, str]], list[str]]:
    parser = FixedBugsPageParser()
    parser.feed(html)
    if not parser.rows:
        raise ValueError(f"No fixed-bug listing table found at {page_url}")

    headers = [" ".join(cell.text).strip().lower() for cell in parser.rows[0]]
    try:
        aci_column = next(index for index, value in enumerate(headers) if "reference" in value)
        summary_column = next(index for index, value in enumerate(headers) if "summary" in value)
    except StopIteration as exc:
        raise ValueError(f"Fixed-bug table headers are incomplete at {page_url}") from exc
    fixed_column = next(
        (index for index, value in enumerate(headers) if "fixed also" in value),
        None,
    )

    records: dict[str, str] = {}
    evidence: list[dict[str, str]] = []
    discovered_urls: set[str] = set()
    page_version = version_from_url(page_url)
    page_key = str(page_version["versionKey"])

    for row in parser.rows[1:]:
        if max(aci_column, summary_column) >= len(row):
            raise ValueError(f"Malformed record row at {page_url}")
        aci = " ".join(row[aci_column].text).strip().upper()
        if not ACI_PATTERN.fullmatch(aci):
            raise ValueError(f"Malformed ACI reference {aci!r} at {page_url}")
        summary = " ".join(row[summary_column].text).strip()
        if not summary:
            raise ValueError(f"Missing summary for {aci} at {page_url}")
        previous = records.get(aci)
        if previous is not None and previous != summary:
            raise ValueError(f"Conflicting duplicate {aci} at {page_url}")
        records[aci] = summary
        evidence.append({
            "aci": aci,
            "versionKey": page_key,
            "evidenceType": "listed_on_version_page",
            "sourceUrl": page_url,
            "sourcePage": page_key,
            "sourceHash": content_hash,
        })

        if fixed_column is None or fixed_column >= len(row):
            continue
        for href, label in row[fixed_column].links:
            target_url = urljoin(page_url, href)
            if urlparse(target_url).hostname != HOST or "/FixedBugsList/versions/" not in urlparse(target_url).path:
                continue
            try:
                target_version = version_from_url(target_url)
            except ValueError:
                continue
            target_key = str(target_version["versionKey"])
            discovered_urls.add(target_url)
            evidence.append({
                "aci": aci,
                "versionKey": target_key,
                "evidenceType": "fixed_also_with",
                "sourceUrl": page_url,
                "sourcePage": page_key,
                "sourceHash": content_hash,
                "sourceText": label,
            })

    if not records:
        raise ValueError(f"No valid ACI records found at {page_url}")
    return records, evidence, sorted(discovered_urls)


def request_page(url: str) -> tuple[bytes, dict[str, str]]:
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.netloc != HOST:
        raise ValueError(f"Refusing to fetch non-official URL: {url}")
    request = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "text/html"})
    attempts = 5
    for attempt in range(attempts):
        try:
            with urlopen(request, timeout=30) as response:
                if urlparse(response.geturl()).netloc != HOST:
                    raise ValueError(f"Official source redirected off-host: {url}")
                if response.status != 200:
                    raise ValueError(f"Unexpected HTTP status {response.status} for {url}")
                return response.read(), dict(response.headers.items())
        except HTTPError as error:
            if error.code == 404 or error.code < 500 and error.code != 429:
                raise
            if attempt == attempts - 1:
                raise
            retry_after = error.headers.get("Retry-After")
            delay = max(int(retry_after) if retry_after and retry_after.isdigit() else 0, 2**attempt)
        except (URLError, TimeoutError):
            if attempt == attempts - 1:
                raise
            delay = 2**attempt
        time.sleep(delay)
    raise RuntimeError(f"Could not fetch {url}")


def crawl(seeds: list[str], max_pages: int) -> dict[str, object]:
    queue = list(dict.fromkeys(seeds))
    queued = set(queue)
    fetched_urls: set[str] = set()
    versions: dict[str, dict[str, object]] = {}
    bugs: dict[str, str] = {}
    evidence_by_key: dict[tuple[str, str, str, str], dict[str, str]] = {}
    source_pages: list[dict[str, object]] = []
    failures: list[str] = []
    last_request = 0.0

    while queue and len(fetched_urls) < max_pages:
        url = queue.pop(0)
        queued.discard(url)
        if url in fetched_urls:
            continue
        pause = 1.0 - (time.monotonic() - last_request)
        if pause > 0:
            time.sleep(pause)
        try:
            body, _headers = request_page(url)
            last_request = time.monotonic()
            content_hash = hashlib.sha256(body).hexdigest()
            RAW_DIR.mkdir(parents=True, exist_ok=True)
            snapshot = RAW_DIR / f"{content_hash}.html"
            if not snapshot.exists():
                snapshot.write_bytes(body)
            html = body.decode("utf-8", errors="replace")
            page_version = version_from_url(url)
            records, page_evidence, discoveries = parse_page(html, url, content_hash)
        except (HTTPError, URLError, TimeoutError, ValueError, UnicodeError) as error:
            last_request = time.monotonic()
            fetched_urls.add(url)
            if isinstance(error, HTTPError) and error.code == 404:
                page_version = version_from_url(url)
                key = str(page_version["versionKey"])
                versions.setdefault(key, {**page_version, "complete": False})
                print(f"warning: official version page unavailable (HTTP 404): {url}", file=sys.stderr)
                continue
            failures.append(f"{url}: {error}")
            print(f"warning: {failures[-1]}", file=sys.stderr)
            continue

        key = str(page_version["versionKey"])
        version = {**page_version, "complete": True}
        versions[key] = version
        for aci, summary in records.items():
            existing = bugs.get(aci)
            if existing is not None and existing != summary:
                raise ValueError(f"Conflicting summaries for {aci} across official pages")
            bugs[aci] = summary
        for item in page_evidence:
            dedupe_key = (
                item["aci"],
                item["versionKey"],
                item["evidenceType"],
                item["sourceUrl"],
            )
            evidence_by_key[dedupe_key] = item
        source_pages.append({
            "versionKey": key,
            "url": url,
            "fetchedAt": datetime.now(timezone.utc).isoformat(),
            "contentSha256": content_hash,
            "recordCount": len(records),
        })
        fetched_urls.add(url)

        for discovered_url in discoveries:
            discovered = version_from_url(discovered_url)
            discovered_key = str(discovered["versionKey"])
            versions.setdefault(discovered_key, {**discovered, "complete": False})
            if discovered_url not in fetched_urls and discovered_url not in queued:
                queue.append(discovered_url)
                queued.add(discovered_url)

    if not source_pages:
        raise RuntimeError("No official source page could be parsed; refusing to generate data")
    if failures:
        raise RuntimeError(
            "One or more discovered source pages failed; refusing to replace the dataset:\n"
            + "\n".join(failures)
        )

    return {
        "schemaVersion": 2,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "historicalCoverageComplete": False,
        "knownReleases": [
            {key: version[key] for key in ("versionKey", "displayName", "sourceUrl")}
            for url in version_seed_urls([
                {"officialSlug": slug}
                for slug in sorted(RELEASE_DATES.keys() | INSTALLER_CREATED_DATES.keys()
                                   | set(HISTORICAL_RELEASE_SEEDS))
            ])
            for version in [version_from_url(url)]
        ],
        "bugs": [{"aci": aci, "summary": bugs[aci]} for aci in sorted(bugs)],
        "versions": sorted(
            versions.values(),
            key=lambda item: (
                int(item["major"]),
                0 if item["line"] == "LTS" else 1,
                int(item["minor"]),
                int(item["hotfix"]),
            ),
        ),
        "evidence": sorted(
            evidence_by_key.values(),
            key=lambda item: (item["aci"], item["versionKey"], item["evidenceType"]),
        ),
        "sourcePages": source_pages,
    }


def validate_database(database: dict[str, object]) -> None:
    bugs = database["bugs"]
    versions = database["versions"]
    evidence = database["evidence"]
    if not isinstance(bugs, list) or not isinstance(versions, list) or not isinstance(evidence, list):
        raise ValueError("Generated dataset collections must be arrays")
    bug_ids = [str(item["aci"]) for item in bugs]
    version_ids = [str(item["versionKey"]) for item in versions]
    if len(bug_ids) != len(set(bug_ids)):
        raise ValueError("Duplicate canonical ACI")
    if len(version_ids) != len(set(version_ids)):
        raise ValueError("Duplicate version key")
    if not bug_ids or not version_ids:
        raise ValueError("Dataset must include at least one ACI and version")
    known_bugs = set(bug_ids)
    known_versions = set(version_ids)
    for item in evidence:
        if item["aci"] not in known_bugs:
            raise ValueError(f"Evidence references unknown ACI: {item['aci']}")
        if item["versionKey"] not in known_versions:
            raise ValueError(f"Evidence references unknown version: {item['versionKey']}")
        if item["evidenceType"] not in {"listed_on_version_page", "fixed_also_with"}:
            raise ValueError(f"Unknown evidence type: {item['evidenceType']}")
        if urlparse(str(item["sourceUrl"])).hostname != HOST:
            raise ValueError(f"Non-official evidence URL: {item['sourceUrl']}")


def check_coverage_regression(previous: dict[str, object], candidate: dict[str, object]) -> None:
    validate_database(previous)
    if not previous["evidence"] or not any(version["complete"] for version in previous["versions"]):
        raise ValueError("Published baseline has no fix evidence or no complete release listings")
    previous_complete = {v["versionKey"] for v in previous["versions"] if v["complete"]}
    candidate_complete = {v["versionKey"] for v in candidate["versions"] if v["complete"]}
    lost_releases = previous_complete - candidate_complete
    problems = []
    if lost_releases:
        problems.append(f"previously indexed releases missing or incomplete: {', '.join(sorted(lost_releases))}")

    def fix_pairs(database: dict[str, object]) -> set[tuple[str, str]]:
        return {(item["aci"], item["versionKey"]) for item in database["evidence"]}

    previous_pairs = fix_pairs(previous)
    lost_pairs = previous_pairs - fix_pairs(candidate)
    if len(lost_pairs) * 100 > len(previous_pairs) * 5:
        problems.append(f"lost {len(lost_pairs)} of {len(previous_pairs)} published ACI/release pairs (limit: 5%)")
    if problems:
        raise ValueError("Refusing to replace published release data: " + "; ".join(problems))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seed-url", action="append", default=[], help="Official version page to seed")
    parser.add_argument("--baseline", type=Path, help="Protect coverage of this published dataset")
    parser.add_argument(
        "--max-pages",
        type=int,
        default=DEFAULT_MAX_PAGES,
        help=f"Maximum pages to fetch (default: {DEFAULT_MAX_PAGES})",
    )
    args = parser.parse_args()
    if args.max_pages < 1:
        parser.error("--max-pages must be at least 1")
    try:
        baseline = read_database(args.baseline) if args.baseline else None
        published_seeds = version_seed_urls(baseline["versions"]) if baseline is not None else []
        historical_seeds = version_seed_urls([
            {"officialSlug": slug} for slug in HISTORICAL_RELEASE_SEEDS
        ])
        seeds = args.seed_url or list(dict.fromkeys([
            DEFAULT_SEED, *historical_seeds, *published_seeds, *existing_version_seeds(),
        ]))
        database = crawl(seeds, args.max_pages)
        validate_database(database)
        if baseline is not None:
            check_coverage_regression(baseline, database)
        OUTPUT.parent.mkdir(parents=True, exist_ok=True)
        temp_output = OUTPUT.with_suffix(".json.tmp")
        temp_output.write_text(json.dumps(database, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        temp_output.replace(OUTPUT)
    except (HTTPError, URLError, TimeoutError, ValueError, RuntimeError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    print(
        f"Wrote {len(database['bugs'])} bugs, {len(database['versions'])} versions, "
        f"{sum(bool(version['complete']) for version in database['versions'])} complete, "
        f"{sum(not bool(version['complete']) for version in database['versions'])} incomplete, "
        f"and {len(database['evidence'])} fix events to {OUTPUT.relative_to(ROOT)}"
    )
    if any(not bool(version["complete"]) for version in database["versions"]):
        print(
            "warning: some discovered versions remain incomplete because their pages were "
            "unavailable or the page limit was reached",
            file=sys.stderr,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
