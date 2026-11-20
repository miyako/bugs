import tempfile
import unittest
from pathlib import Path
from urllib.error import HTTPError
from unittest.mock import patch

from scripts.build_data import check_coverage_regression, crawl, parse_page, version_from_url, version_seed_urls


class BuildDataTests(unittest.TestCase):
    def test_published_coverage_guard(self):
        source = "https://developer.4d.com/FixedBugsList/versions/19.2/"
        version = {**version_from_url(source), "complete": True}
        bugs = [{"aci": f"ACI{i:07d}"} for i in range(22)]
        evidence = [
            {"aci": bug["aci"], "versionKey": "19.2",
             "evidenceType": "listed_on_version_page", "sourceUrl": source}
            for bug in bugs
        ]
        previous = {"bugs": bugs, "versions": [version], "evidence": evidence[:20]}
        check_coverage_regression(previous, {**previous, "evidence": evidence[1:]})
        with self.assertRaisesRegex(ValueError, "lost 2 of 20 published ACI/release pairs"):
            check_coverage_regression(previous, {**previous, "evidence": evidence[2:]})
        with self.assertRaisesRegex(ValueError, "missing or incomplete: 19.2"):
            check_coverage_regression(previous, {
                **previous, "versions": [{**version, "complete": False}], "evidence": evidence,
            })

    def test_version_identity_keeps_lts_and_feature_lines_distinct(self):
        lts = version_from_url("https://developer.4d.com/FixedBugsList/versions/21.2/")
        feature = version_from_url("https://developer.4d.com/FixedBugsList/versions/21_R4_HF1/")

        self.assertEqual(lts["versionKey"], "21.2")
        self.assertEqual(lts["line"], "LTS")
        self.assertEqual(lts["branchId"], "21-LTS")
        self.assertEqual(feature["versionKey"], "21_R4_HF1")
        self.assertEqual(feature["line"], "R")
        self.assertEqual(feature["branchId"], "21-R4")
        self.assertEqual(lts["releasedAt"], "2026-09-07")
        self.assertIsNone(feature["releasedAt"])

    def test_release_chronology_is_explicit_and_versioned_by_date(self):
        lts = version_from_url("https://developer.4d.com/FixedBugsList/versions/21.1/")
        feature = version_from_url("https://developer.4d.com/FixedBugsList/versions/21_R3/")

        self.assertLess(lts["releasedAt"], "2026-09-07")
        self.assertLess(feature["releasedAt"], "2026-09-07")
        self.assertEqual(lts["releaseDateSource"], "https://es.4d.com/211-lts")

        hotfix = version_from_url(
            "https://developer.4d.com/FixedBugsList/versions/21.1_HF2/"
        )
        self.assertEqual(hotfix["releasedAt"], "2026-08-19")
        self.assertTrue(str(hotfix["releaseDateSource"]).startswith("https://github.com/4d/"))

        older_hotfix = version_from_url(
            "https://developer.4d.com/FixedBugsList/versions/20.8_HF3/"
        )
        self.assertEqual(older_hotfix["releasedAt"], "2026-06-05")

    def test_4d_19_metadata_distinguishes_launch_and_installer_dates(self):
        prefix = "https://developer.4d.com/FixedBugsList/versions"
        release = version_from_url(f"{prefix}/19/")
        self.assertEqual(release["releasedAt"], "2021-07-12")
        self.assertEqual(release["releaseDateSource"], "https://blog.4d.com/4d-v19-is-here/")
        for slug, date in {
            "19.1": "2021-11-30", "19.2": "2022-03-04",
            "19.3": "2022-05-23", "19.4": "2022-09-09",
        }.items():
            with self.subTest(slug=slug):
                minor = version_from_url(f"{prefix}/{slug}/")
                self.assertIsNone(minor["releasedAt"])
                self.assertIsNone(minor["releaseDateSource"])
                self.assertEqual(minor["installerCreatedAt"], date)
                self.assertTrue(minor["installerDateSource"].endswith(f"version_number={slug}"))

    def test_existing_version_seeds_are_canonical_and_validated(self):
        seeds = version_seed_urls([
            {"officialSlug": "21.2"},
            {"officialSlug": "21_R4_HF1"},
        ])

        self.assertEqual(seeds, [
            "https://developer.4d.com/FixedBugsList/versions/21.2/",
            "https://developer.4d.com/FixedBugsList/versions/21_R4_HF1/",
        ])
        with self.assertRaisesRegex(ValueError, "Invalid official version slug"):
            version_seed_urls([{"officialSlug": "../other"}])

    def test_crawl_keeps_404_versions_incomplete_and_continues(self):
        missing_url = "https://developer.4d.com/FixedBugsList/versions/15/"
        available_url = "https://developer.4d.com/FixedBugsList/versions/21.2/"
        page = b"""
        <table class="list">
          <tr><th>Reference</th><th>Summary</th></tr>
          <tr><td>ACI0106214</td><td>Example summary</td></tr>
        </table>
        """

        def request(url):
            if url == missing_url:
                raise HTTPError(url, 404, "Not Found", None, None)
            return page, {}

        with tempfile.TemporaryDirectory() as raw_dir:
            with patch("scripts.build_data.RAW_DIR", Path(raw_dir)), \
                    patch("scripts.build_data.request_page", side_effect=request), \
                    patch("scripts.build_data.time.sleep"):
                database = crawl([missing_url, available_url], max_pages=2)

        versions = {version["versionKey"]: version for version in database["versions"]}
        self.assertFalse(versions["15"]["complete"])
        self.assertTrue(versions["21.2"]["complete"])
        self.assertEqual([bug["aci"] for bug in database["bugs"]], ["ACI0106214"])

    def test_parser_keeps_direct_evidence_and_explicit_fix_links(self):
        html = """
        <table class="list">
          <tr><th>Reference</th><th>Summary</th><th>Fixed also with</th></tr>
          <tr>
            <td>ACI0106214</td><td>Example summary</td>
            <td><a href="../../versions/21.1_HF1/">21.1 HF1</a></td>
          </tr>
        </table>
        """
        records, events, discoveries = parse_page(
            html,
            "https://developer.4d.com/FixedBugsList/versions/21.2/",
            "abc123",
        )

        self.assertEqual(records, {"ACI0106214": "Example summary"})
        self.assertEqual([event["evidenceType"] for event in events], [
            "listed_on_version_page",
            "fixed_also_with",
        ])
        self.assertEqual(events[1]["versionKey"], "21.1_HF1")
        self.assertEqual(discoveries, [
            "https://developer.4d.com/FixedBugsList/versions/21.1_HF1/",
        ])

    def test_parser_rejects_missing_listing_table(self):
        with self.assertRaisesRegex(ValueError, "No fixed-bug listing table"):
            parse_page(
                "<html><body>Unavailable</body></html>",
                "https://developer.4d.com/FixedBugsList/versions/21.2/",
                "abc123",
            )

    def test_parser_fails_instead_of_silently_dropping_malformed_records(self):
        html = """
        <table class="list">
          <tr><th>Reference</th><th>Summary</th></tr>
          <tr><td>not-an-aci</td><td>Example summary</td></tr>
        </table>
        """
        with self.assertRaisesRegex(ValueError, "Malformed ACI reference"):
            parse_page(
                html,
                "https://developer.4d.com/FixedBugsList/versions/21.2/",
                "abc123",
            )


if __name__ == "__main__":
    unittest.main()
