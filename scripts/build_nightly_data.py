"""Index official 4D nightly and beta fix listings by branch and build."""

from __future__ import annotations

import argparse
import json
import re
import time
from datetime import date, datetime, timezone
from pathlib import Path

from scripts.build_data import ACI_PATTERN, HOST, ROOT, FixedBugsPageParser, request_page

BRANCHES = ("19", "20", "20_R10", "21", "21_R2", "21_R3", "21_R4", "21_R5")
OUTPUT = ROOT / "src" / "data" / "nightly-fixes.json"
BUILD_PATTERN = re.compile(r"[1-9][0-9]{0,8}")
BRANCH_PATTERN = re.compile(r"[0-9]+(?:_R[0-9]+)?")


def nightly_url(branch: str) -> str:
    return f"https://{HOST}/FixedBugsList/nightly/{branch}/"


def parse_nightly_page(html: str, url: str) -> list[dict]:
    parser = FixedBugsPageParser()
    parser.feed(html)
    if not parser.rows:
        raise ValueError(f"No nightly build table found at {url}")
    headers = [" ".join(cell.text).lower() for cell in parser.rows[0]]
    if not {"build number", "reference"} <= set(headers):
        raise ValueError(f"Nightly build table headers are incomplete at {url}")
    build_column = headers.index("build number")
    aci_column = headers.index("reference")

    fixes = []
    build = None
    for row in parser.rows[1:]:
        if max(build_column, aci_column) >= len(row):
            raise ValueError(f"Malformed nightly build row at {url}")
        build_text = " ".join(row[build_column].text)
        if build_text:
            if not BUILD_PATTERN.fullmatch(build_text):
                raise ValueError(f"Invalid nightly build {build_text!r} at {url}")
            build = int(build_text)
        aci = " ".join(row[aci_column].text).upper()
        if build is None or not ACI_PATTERN.fullmatch(aci):
            raise ValueError(f"Nightly fix has no valid ACI or build at {url}")
        fixes.append({"aci": aci, "buildNumber": build})
    return fixes


def read_history(path: Path) -> list[dict]:
    records = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(records, list):
        raise ValueError(f"{path}: expected a list of nightly fixes")
    for row in records:
        if not isinstance(row, dict):
            raise ValueError(f"{path}: invalid nightly fix record")
        branch, aci, build = row.get("branch"), row.get("aci"), row.get("buildNumber")
        if (
            not isinstance(branch, str) or not BRANCH_PATTERN.fullmatch(branch)
            or not isinstance(aci, str) or not ACI_PATTERN.fullmatch(aci)
            or type(build) is not int or not BUILD_PATTERN.fullmatch(str(build))
            or row.get("sourceUrl") != nightly_url(branch)
        ):
            raise ValueError(f"{path}: invalid nightly fix record")
        if "firstObservedOn" in row:
            observed = row["firstObservedOn"]
            if not isinstance(observed, str) or date.fromisoformat(observed).isoformat() != observed:
                raise ValueError(f"{path}: invalid observation date")
    return records


def merge_history(*snapshots: list[dict]) -> list[dict]:
    merged = {}
    for snapshot in snapshots:
        for fix in snapshot:
            key = fix["branch"], fix["buildNumber"], fix["aci"]
            current = merged.get(key)
            observed = fix.get("firstObservedOn")
            previous = current.get("firstObservedOn") if current else None
            if current is None or (observed and (not previous or observed < previous)):
                merged[key] = fix
    return [merged[key] for key in sorted(merged)]


def refresh_history(output: Path, archive: Path | None = None) -> None:
    seed = read_history(output) if output.exists() else []
    saved = read_history(archive) if archive is not None else []
    observed = []
    for index, branch in enumerate(BRANCHES):
        if index:
            time.sleep(1)
        url = nightly_url(branch)
        body, _ = request_page(url)
        observed_on = datetime.now(timezone.utc).date().isoformat()
        for fix in parse_nightly_page(body.decode("utf-8"), url):
            observed.append({
                **fix, "branch": branch, "sourceUrl": url, "firstObservedOn": observed_on,
            })
    fixes = merge_history(seed, saved, observed)
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(fixes, indent=2) + "\n", encoding="utf-8")
    temporary.replace(output)
    metadata = output.with_name("nightly-refresh.json")
    temporary_metadata = metadata.with_suffix(".json.tmp")
    temporary_metadata.write_text(
        json.dumps({"refreshedAt": datetime.now(timezone.utc).isoformat()}, indent=2) + "\n",
        encoding="utf-8",
    )
    temporary_metadata.replace(metadata)
    print(f"Archived {len(fixes)} nightly fixes ({len(observed)} in the current listings)")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, help="Nightly history from a previous deployment")
    args = parser.parse_args()
    refresh_history(OUTPUT, args.archive)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError) as error:
        raise SystemExit(f"Nightly refresh failed: {error}") from error
