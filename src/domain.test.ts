import { describe, expect, it } from "vitest";
import {
  type BugDatabase,
  normalizeAci,
  resolveFixStatus,
} from "./domain";

const database: BugDatabase = {
  schemaVersion: 1,
  generatedAt: "2026-11-20T00:00:00Z",
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
      complete: false,
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

  it("does not infer across release lines or incomplete pages", () => {
    expect(resolveFixStatus(database, "ACI0106214", "21_R4").verdict).toBe("UNKNOWN");
    expect(resolveFixStatus(database, "ACI0106214", "21_R4").reasonCode).toBe(
      "VERSION_DATA_INCOMPLETE",
    );
    const completeFeatureLine = {
      ...database,
      versions: database.versions.map((version) =>
        version.versionKey === "21_R4" ? { ...version, complete: true } : version,
      ),
    };
    expect(resolveFixStatus(completeFeatureLine, "ACI0106214", "21_R4").verdict).toBe(
      "NO",
    );
  });

  it("returns NO only when the exact target page is complete", () => {
    expect(resolveFixStatus(database, "ACI0106214", "21.2").reasonCode).toBe(
      "FIXED_EXPLICIT",
    );
    const result = resolveFixStatus(database, "ACI0106214", "21.1");
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

  it("returns UNKNOWN for unknown ACIs and versions", () => {
    expect(resolveFixStatus(database, "ACI9999999", "21.2").reasonCode).toBe(
      "ACI_NOT_FOUND",
    );
    expect(resolveFixStatus(database, "ACI0106214", "22.0").reasonCode).toBe(
      "VERSION_NOT_INDEXED",
    );
  });
});
