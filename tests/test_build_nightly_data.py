import json
import unittest
from datetime import datetime
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from scripts.build_nightly_data import nightly_url, parse_nightly_page, refresh_history


class BuildNightlyDataTests(unittest.TestCase):
    def test_build_numbers_carry_down_only_until_the_next_build(self):
        html = """
        <table class="list">
          <tr><td>Build number</td><td>Build date</td><td>Reference</td></tr>
          <tr><td>100672</td><td>16/11/2026</td><td>ACI0106521</td></tr>
          <tr><td>100670</td><td>11/11/2026</td><td>ACI0106664</td></tr>
          <tr><td></td><td></td><td>ACI0106659</td></tr>
        </table>
        """
        self.assertEqual(parse_nightly_page(html, "nightly/21/"), [
            {"aci": "ACI0106521", "buildNumber": 100672},
            {"aci": "ACI0106664", "buildNumber": 100670},
            {"aci": "ACI0106659", "buildNumber": 100670},
        ])

    def test_rejects_a_fix_without_a_preceding_build(self):
        html = """
        <table class="list">
          <tr><td>Build number</td><td>Reference</td></tr>
          <tr><td></td><td>ACI0106659</td></tr>
        </table>
        """
        with self.assertRaisesRegex(ValueError, "no valid ACI or build"):
            parse_nightly_page(html, "nightly/21/")

    @patch("scripts.build_nightly_data.BRANCHES", ("21",))
    @patch("scripts.build_nightly_data.request_page")
    def test_fresh_checkout_keeps_first_observation_after_rollover(self, request_page):
        table = (
            '<table class="list"><tr><td>Build number</td><td>Reference</td></tr>'
            '<tr><td>{}</td><td>{}</td></tr></table>'
        )
        request_page.side_effect = [
            (table.format("100670", "ACI0106659").encode(), {}),
            (table.format("100685", "ACI0106800").encode(), {}),
            (table.format("100685", "ACI0106800").encode(), {}),
        ]
        with TemporaryDirectory() as directory:
            archive = Path(directory) / "previous.json"
            fresh_output = Path(directory) / "next.json"
            refresh_history(archive)
            saved_fix, = json.loads(archive.read_text())
            self.assertEqual(saved_fix["aci"], "ACI0106659")
            self.assertEqual(saved_fix["buildNumber"], 100670)
            self.assertEqual(saved_fix["sourceUrl"], nightly_url("21"))
            self.assertRegex(saved_fix["firstObservedOn"], r"^\d{4}-\d{2}-\d{2}$")

            refresh_history(fresh_output, archive)
            refresh_history(fresh_output, archive)
            retained, new = json.loads(fresh_output.read_text())
            self.assertEqual(retained, saved_fix)
            self.assertEqual(new["aci"], "ACI0106800")
            metadata = json.loads(fresh_output.with_name("nightly-refresh.json").read_text())
            self.assertIsNotNone(datetime.fromisoformat(metadata["refreshedAt"]).utcoffset())

    @patch("scripts.build_nightly_data.BRANCHES", ("21",))
    @patch("scripts.build_nightly_data.request_page", return_value=(b"not a listing", {}))
    def test_invalid_fetch_does_not_replace_the_snapshot(self, _request_page):
        with TemporaryDirectory() as directory:
            output = Path(directory) / "nightly-fixes.json"
            output.write_text("[]\n")
            metadata = output.with_name("nightly-refresh.json")
            metadata.write_text('{"refreshedAt": "2026-11-19T14:00:00+00:00"}\n')
            with self.assertRaisesRegex(ValueError, "No nightly build table"):
                refresh_history(output)
            self.assertEqual(output.read_text(), "[]\n")
            self.assertEqual(
                json.loads(metadata.read_text())["refreshedAt"], "2026-11-19T14:00:00+00:00",
            )
