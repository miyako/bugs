import unittest

from scripts.build_data import parse_page, version_from_url


class BuildDataTests(unittest.TestCase):
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
