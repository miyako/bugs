import unittest

from scripts.build_nightly_data import parse_nightly_page


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
