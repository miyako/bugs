"""Index official 4D nightly and beta fix listings by branch and build."""

import json
import re
import time
from urllib.error import URLError

from scripts.build_data import ACI_PATTERN, HOST, ROOT, FixedBugsPageParser, request_page

BRANCHES = ("19", "20", "20_R10", "21", "21_R2", "21_R3", "21_R4", "21_R5")
OUTPUT = ROOT / "src" / "data" / "nightly-fixes.json"
BUILD_PATTERN = re.compile(r"[1-9][0-9]{0,8}")


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


def main() -> None:
    fixes = []
    for index, branch in enumerate(BRANCHES):
        if index:
            time.sleep(1)
        url = f"https://{HOST}/FixedBugsList/nightly/{branch}/"
        body, _ = request_page(url)
        for fix in parse_nightly_page(body.decode("utf-8"), url):
            fixes.append({**fix, "branch": branch, "sourceUrl": url})
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    temporary = OUTPUT.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(fixes, indent=2) + "\n", encoding="utf-8")
    temporary.replace(OUTPUT)
    print(f"Wrote {len(fixes)} fix entries from {len(BRANCHES)} nightly/beta listings to {OUTPUT.relative_to(ROOT)}")


if __name__ == "__main__":
    try:
        main()
    except (URLError, TimeoutError, ValueError) as error:
        raise SystemExit(f"Nightly refresh failed: {error}") from error
