import { describe, expect, it } from "vitest";
import {
  type BugDatabase,
  normalizeAci,
  resolveFixStatus,
} from "./domain";

const database: BugDatabase = {
  schemaVersion: 2,
  generatedAt: "2026-11-20T00:00:00Z",
  historicalCoverageComplete: false,
  bugs: [{ aci: "ACI0106214", summary: "Example bug" }],
  versions: [
    {
      versionKey: "21.2",
      displayName: "21.2 LTS",
      major: 21,
      line: "LTS",
      minor: 2,
      hotfix: 0,
      kind: "release",
      branchId: "21-LTS",
      officialSlug: "21.2",
      sourceUrl: "https://developer.4d.com/FixedBugsList/versions/21.2/",
      releasedAt: "2026-09-07",
      releaseDateSource: "https://eu-en.4d.com/4d-212-lts",
      complete: true,
    },
    {
      versionKey: "21.1",
      displayName: "21.1 LTS",
      major: 21,
      line: "LTS",
      minor: 1,
      hotfix: 0,
      kind: "release",
      branchId: "21-LTS",
      officialSlug: "21.1",
      sourceUrl: "https://developer.4d.com/FixedBugsList/versions/21.1/",
      releasedAt: "2026-05-20",
      releaseDateSource: "https://es.4d.com/211-lts",
      complete: true,
    },
    {
      versionKey: "21.1_HF1",
      displayName: "21.1 HF1",
      major: 21,
      line: "LTS",
      minor: 1,
      hotfix: 1,
      kind: "release",
      branchId: "21-LTS",
      officialSlug: "21.1_HF1",
      sourceUrl: "https://developer.4d.com/FixedBugsList/versions/21.1_HF1/",
      releasedAt: "2026-06-26",
      releaseDateSource: "https://github.com/4d/4D_Info_Report/releases/tag/4.98.2",
      complete: false,
    },
    {
      versionKey: "21.1_HF2",
      displayName: "21.1 HF2",
      major: 21,
      line: "LTS",
      minor: 1,
      hotfix: 2,
      kind: "release",
      branchId: "21-LTS",
      officialSlug: "21.1_HF2",
      sourceUrl: "https://developer.4d.com/FixedBugsList/versions/21.1_HF2/",
      releasedAt: "2026-08-19",
      releaseDateSource: "https://github.com/4d/4D_Info_Report/releases/tag/4.98.1",
      complete: false,
    },
    {
      versionKey: "20.8_HF3",
      displayName: "20.8 HF3",
      major: 20,
      line: "LTS",
      minor: 8,
      hotfix: 3,
      kind: "release",
      branchId: "20-LTS",
      officialSlug: "20.8_HF3",
      sourceUrl: "https://developer.4d.com/FixedBugsList/versions/20.8_HF3/",
      releasedAt: "2026-06-05",
      releaseDateSource: "https://github.com/4d/4D_Info_Report/releases/tag/4.98.2",
      complete: false,
    },
    {
      versionKey: "21_R3",
      displayName: "21 R3",
      major: 21,
      line: "R",
      minor: 3,
      hotfix: 0,
      kind: "release",
      branchId: "21-R3",
      officialSlug: "21_R3",
      sourceUrl: "https://developer.4d.com/FixedBugsList/versions/21_R3/",
      releasedAt: "2026-07-07",
      releaseDateSource: "https://blog.4d.com/4d-21-r3-is-here/",
      complete: true,
    },
    {
      versionKey: "21_R4",
      displayName: "21 R4",
      major: 21,
      line: "R",
      minor: 4,
      hotfix: 0,
      kind: "release",
      branchId: "21-R4",
      officialSlug: "21_R4",
      sourceUrl: "https://developer.4d.com/FixedBugsList/versions/21_R4/",
      releasedAt: "2026-10-12",
      releaseDateSource: "https://blog.4d.com/4d-21-r4-is-here/",
      complete: false,
    },
    {
      versionKey: "20.9",
      displayName: "20.9 LTS",
      major: 20,
      line: "LTS",
      minor: 9,
      hotfix: 0,
      kind: "release",
      branchId: "20-LTS",
      officialSlug: "20.9",
      sourceUrl: "https://developer.4d.com/FixedBugsList/versions/20.9/",
      releasedAt: "2026-09-23",
      releaseDateSource: "https://us.4d.com/product-download/4D-20-LTS",
      complete: true,
    },
    {
      versionKey: "21.2_HF1",
      displayName: "21.2 HF1",
      major: 21,
      line: "LTS",
      minor: 2,
      hotfix: 1,
      kind: "release",
      branchId: "21-LTS",
      officialSlug: "21.2_HF1",
      sourceUrl: "https://developer.4d.com/FixedBugsList/versions/21.2_HF1/",
      releasedAt: null,
      releaseDateSource: null,
      complete: false,
    },
  ],
  evidence: [
    {
      aci: "ACI0106214",
      versionKey: "21.2",
      evidenceType: "listed_on_version_page",
      sourceUrl: "https://developer.4d.com/FixedBugsList/versions/21.2/",
      sourcePage: "21.2",
      sourceHash: "source-hash",
    },
    {
      aci: "ACI0106214",
      versionKey: "21.1_HF1",
      evidenceType: "fixed_also_with",
      sourceUrl: "https://developer.4d.com/FixedBugsList/versions/21.2/",
      sourcePage: "21.2",
      sourceHash: "source-hash",
    },
  ],
  sourcePages: [],
};

describe("normalizeAci", () => {
  it.each(["ACI0106214", "aci0106214", "ACI 0106214", "ACI-0106214", "0106214"])(
    "normalizes %s",
    (input) => expect(normalizeAci(input)).toBe("ACI0106214"),
  );

  it.each(["106214", "ACI010621", "not-an-aci"])("rejects ambiguous %s", (input) => {
    expect(normalizeAci(input)).toBeNull();
  });
});

describe("resolveFixStatus", () => {
  it("returns YES only for explicit evidence", () => {
    expect(resolveFixStatus(database, "ACI0106214", "21.2").verdict).toBe("YES");
    expect(resolveFixStatus(database, "ACI0106214", "21.1_HF1").verdict).toBe("YES");
  });

  it("does not infer from a later release or an incomplete page", () => {
    expect(resolveFixStatus(database, "ACI0106214", "21_R4").verdict).toBe("YES");
    expect(resolveFixStatus(database, "ACI0106214", "21_R4").reasonCode).toBe(
      "FIXED_CARRIED_FORWARD",
    );
    expect(resolveFixStatus(database, "ACI0106214", "21.2_HF1").verdict).toBe(
      "UNKNOWN",
    );
    expect(resolveFixStatus(database, "ACI0106214", "21.2_HF1").reasonCode).toBe(
      "VERSION_DATA_INCOMPLETE",
    );
    const completeLaterRelease = {
      ...database,
      historicalCoverageComplete: true,
      versions: database.versions.map((version) =>
        version.versionKey === "21_R4" ? { ...version, complete: true } : version,
      ),
    };
    expect(resolveFixStatus(completeLaterRelease, "ACI0106214", "21_R4").verdict).toBe(
      "YES",
    );
  });

  it("carries a fix from a chronologically earlier release across release lines", () => {
    const olderFix = {
      ...database,
      evidence: [{ ...database.evidence[0], versionKey: "21.1" }],
    };
    const result = resolveFixStatus(olderFix, "ACI0106214", "21.2");
    expect(result.verdict).toBe("YES");
    expect(result.reasonCode).toBe("FIXED_CARRIED_FORWARD");
    expect(result.evidence[0].versionKey).toBe("21.1");
  });

  it("carries a dated hotfix forward to a later LTS release", () => {
    const hotfix = {
      ...database,
      evidence: [{ ...database.evidence[0], versionKey: "20.8_HF3" }],
    };
    const result = resolveFixStatus(hotfix, "ACI0106214", "21.2");
    expect(result.verdict).toBe("YES");
    expect(result.reasonCode).toBe("FIXED_CARRIED_FORWARD");
  });

  it("returns UNKNOWN when complete target data lacks historical coverage", () => {
    const laterOnly = { ...database, evidence: [database.evidence[0]] };
    const result = resolveFixStatus(laterOnly, "ACI0106214", "21_R3");
    expect(result.verdict).toBe("UNKNOWN");
    expect(result.reasonCode).toBe("HISTORICAL_COVERAGE_INCOMPLETE");
  });

  it("returns UNKNOWN when a known fix has no comparable release date", () => {
    const unknownChronology = {
      ...database,
      historicalCoverageComplete: true,
      evidence: [{ ...database.evidence[0], versionKey: "21.2_HF1" }],
    };
    const result = resolveFixStatus(unknownChronology, "ACI0106214", "21_R3");
    expect(result.verdict).toBe("UNKNOWN");
    expect(result.reasonCode).toBe("CHRONOLOGY_UNAVAILABLE");
  });

  it("does not carry a later fix backward", () => {
    const laterFix = {
      ...database,
      historicalCoverageComplete: true,
      evidence: [{ ...database.evidence[0], versionKey: "20.9" }],
    };
    const result = resolveFixStatus(laterFix, "ACI0106214", "21.2");
    expect(result.verdict).toBe("NO");
    expect(result.reasonCode).toBe("NOT_LISTED_IN_VERSION");
  });

  it("keeps build status independent from version status", () => {
    const result = resolveFixStatus(database, "ACI0106214", "21.2", "100667");
    expect(result.verdict).toBe("YES");
    expect(result.build).toEqual({
      verdict: "UNKNOWN",
      reasonCode: "BUILD_DATA_UNAVAILABLE",
      buildNumber: "100667",
    });
  });

  it("finds a nightly-only ACI in its first fixed build and carries it forward on the same branch", () => {
    const fix = {
      aci: "ACI0106659",
      branch: "21",
      buildNumber: 100670,
      sourceUrl: "https://developer.4d.com/FixedBugsList/nightly/21/",
    };
    for (const build of ["100670", "100672"]) {
      const result = resolveFixStatus(database, fix.aci, "21.2", build, [fix]);
      expect(result.verdict).toBe("UNKNOWN");
      expect(result.build).toEqual({
        verdict: "YES", reasonCode: "NIGHTLY_FIX", buildNumber: build, evidence: fix,
      });
    }
    expect(resolveFixStatus(database, fix.aci, "21_R4", "100672", [fix]).build?.verdict).toBe("UNKNOWN");
  });

  it("shows the earliest later fix for a verified release build or an explicitly entered build", () => {
    const firstFix = {
      aci: "ACI0106659",
      branch: "21",
      buildNumber: 100670,
      sourceUrl: "https://developer.4d.com/FixedBugsList/nightly/21/",
    };
    const fixes = [{ ...firstFix, buildNumber: 100675 }, { ...firstFix, branch: "21_R4" }, firstFix];
    const releaseResult = resolveFixStatus(database, firstFix.aci, "21.2", "", fixes);
    expect(releaseResult.verdict).toBe("UNKNOWN");
    expect(releaseResult.build).toEqual({
      verdict: "UNKNOWN", reasonCode: "FIX_LISTED_LATER", buildNumber: "100579",
      evidence: firstFix, releaseBuildSource: "https://eu-en.4d.com/4d-212-lts-full-installer",
    });
    expect(resolveFixStatus(database, firstFix.aci, "21.2", "100669", fixes).build)
      .toMatchObject({ reasonCode: "FIX_LISTED_LATER", buildNumber: "100669", evidence: firstFix });
    expect(resolveFixStatus(database, firstFix.aci, "21.1", "", fixes).build).toBeNull();
    expect(resolveFixStatus(database, firstFix.aci, "21_R4", "100669", [firstFix]).build)
      .toMatchObject({ reasonCode: "BUILD_DATA_UNAVAILABLE" });
    expect(resolveFixStatus(database, "ACI0106214", "21.2", "", [{ ...firstFix, aci: "ACI0106214" }]).build)
      .toBeNull();
  });

  it("returns UNKNOWN for unknown ACIs and versions", () => {
    expect(resolveFixStatus(database, "ACI9999999", "21.2").reasonCode).toBe(
      "ACI_NOT_FOUND",
    );
    expect(resolveFixStatus(database, "ACI0106214", "22.0").reasonCode).toBe(
      "VERSION_NOT_INDEXED",
    );
  });
});
