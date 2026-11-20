export type Verdict = "YES" | "NO" | "UNKNOWN";

export interface ReleaseVersion {
  versionKey: string;
  displayName: string;
  major: number;
  line: "LTS" | "R";
  minor: number;
  hotfix: number;
  kind: "release" | "nightly";
  branchId: string;
  officialSlug: string;
  sourceUrl: string;
  releasedAt: string | null;
  releaseDateSource: string | null;
  complete: boolean;
}

export interface Bug {
  aci: string;
  summary: string;
}

export interface FixEvidence {
  aci: string;
  versionKey: string;
  evidenceType: "listed_on_version_page" | "fixed_also_with";
  sourceUrl: string;
  sourcePage: string;
  sourceHash: string;
  sourceText?: string;
}

export interface SourcePage {
  versionKey: string;
  url: string;
  fetchedAt: string;
  contentSha256: string;
  recordCount: number;
}

export interface BugDatabase {
  schemaVersion: 2;
  generatedAt: string;
  historicalCoverageComplete: boolean;
  bugs: Bug[];
  versions: ReleaseVersion[];
  evidence: FixEvidence[];
  sourcePages: SourcePage[];
}

export interface NightlyFix {
  aci: string;
  branch: string;
  buildNumber: number;
  sourceUrl: string;
}

const RELEASE_BUILDS: Readonly<Partial<Record<string, { number: string; sourceUrl: string }>>> = {
  "19.8": { number: "292264", sourceUrl: "https://eu-en.4d.com/4d-198-lts-full-installer" },
  "20.9": { number: "102090", sourceUrl: "https://us.4d.com/4d-209-full-installer" },
  "21.1": { number: "100468", sourceUrl: "https://eu-en.4d.com/4d-211-lts-full-installer" },
  "21.2": { number: "100579", sourceUrl: "https://eu-en.4d.com/4d-212-lts-full-installer" },
  "21.2_HF2": { number: "100653", sourceUrl: "https://developer.4d.com/FixedBugsList/nightly/21/" },
};

type BuildResult = {
  buildNumber: string;
} & (
  | { verdict: "YES"; reasonCode: "NIGHTLY_FIX"; evidence: NightlyFix }
  | { verdict: "UNKNOWN"; reasonCode: "FIX_LISTED_LATER"; evidence: NightlyFix; releaseBuildSource?: string }
  | { verdict: "UNKNOWN"; reasonCode: "BUILD_DATA_UNAVAILABLE" }
);

export interface ResolverResult {
  verdict: Verdict;
  reasonCode:
    | "FIXED_EXPLICIT"
    | "FIXED_CARRIED_FORWARD"
    | "NOT_LISTED_IN_VERSION"
    | "HISTORICAL_COVERAGE_INCOMPLETE"
    | "CHRONOLOGY_UNAVAILABLE"
    | "ACI_INVALID"
    | "ACI_NOT_FOUND"
    | "VERSION_NOT_INDEXED"
    | "VERSION_DATA_INCOMPLETE";
  aci: string | null;
  queriedVersion: ReleaseVersion | null;
  evidence: FixEvidence[];
  otherKnownFixes: ReleaseVersion[];
  build: BuildResult | null;
}

export function nightlyBranch(version: ReleaseVersion): string {
  return version.line === "R" ? `${version.major}_R${version.minor}` : `${version.major}`;
}

export function normalizeAci(value: string): string | null {
  const normalized = value.trim().toUpperCase().replace(/[\s._-]/g, "");
  const match = /^(?:ACI)?(\d{7})$/.exec(normalized);
  return match ? `ACI${match[1]}` : null;
}

export function findFixHistory(
  database: BugDatabase,
  aciInput: string,
  nightlyFixes: readonly NightlyFix[] = [],
) {
  const aci = normalizeAci(aciInput);
  const releases = new Map<string, FixEvidence>();
  const nightlies = new Map<string, NightlyFix>();
  if (aci) {
    for (const fix of database.evidence) {
      if (fix.aci === aci && (!releases.has(fix.versionKey) || fix.evidenceType === "listed_on_version_page")) {
        releases.set(fix.versionKey, fix);
      }
    }
    for (const fix of nightlyFixes) {
      if (fix.aci !== aci) continue;
      const current = nightlies.get(fix.branch);
      if (!current || fix.buildNumber < current.buildNumber) nightlies.set(fix.branch, fix);
    }
  }
  return {
    aci,
    releases: [...releases.values()],
    nightlies: [...nightlies.values()],
  };
}

export function resolveFixStatus(
  database: BugDatabase,
  aciInput: string,
  versionKey: string,
  buildInput = "",
  nightlyFixes: readonly NightlyFix[] = [],
): ResolverResult {
  const aci = normalizeAci(aciInput);
  const version = database.versions.find((entry) => entry.versionKey === versionKey);
  const requestedBuild = buildInput.trim();
  const releaseBuild = version && !requestedBuild ? RELEASE_BUILDS[version.versionKey] : undefined;
  const buildNumber = requestedBuild || releaseBuild?.number || "";
  const branch = version && nightlyBranch(version);
  const firstFix = aci && branch && /^[1-9][0-9]{0,8}$/.test(buildNumber)
    ? nightlyFixes.reduce<NightlyFix | undefined>((earliest, fix) =>
        fix.aci === aci && fix.branch === branch
          && (!earliest || fix.buildNumber < earliest.buildNumber) ? fix : earliest,
      undefined)
    : undefined;
  let build: BuildResult | null = null;
  if (firstFix && firstFix.buildNumber > Number(buildNumber)) {
    build = {
      verdict: "UNKNOWN",
      reasonCode: "FIX_LISTED_LATER",
      buildNumber,
      evidence: firstFix,
      releaseBuildSource: releaseBuild?.sourceUrl,
    };
  } else if (requestedBuild) {
    build = firstFix
      ? { verdict: "YES", reasonCode: "NIGHTLY_FIX", buildNumber, evidence: firstFix }
      : { verdict: "UNKNOWN", reasonCode: "BUILD_DATA_UNAVAILABLE", buildNumber };
  }

  if (!aci) {
    return {
      verdict: "UNKNOWN",
      reasonCode: "ACI_INVALID",
      aci: null,
      queriedVersion: version ?? null,
      evidence: [],
      otherKnownFixes: [],
      build,
    };
  }

  if (!version) {
    return {
      verdict: "UNKNOWN",
      reasonCode: "VERSION_NOT_INDEXED",
      aci,
      queriedVersion: null,
      evidence: [],
      otherKnownFixes: [],
      build,
    };
  }

  if (!database.bugs.some((bug) => bug.aci === aci)) {
    return {
      verdict: "UNKNOWN",
      reasonCode: "ACI_NOT_FOUND",
      aci,
      queriedVersion: version,
      evidence: [],
      otherKnownFixes: [],
      build,
    };
  }

  const knownEvidence = database.evidence.filter((entry) => entry.aci === aci);
  const evidence = knownEvidence.filter((entry) => entry.versionKey === versionKey);
  const otherKnownFixes = [...new Set(
    knownEvidence
      .filter((entry) => entry.versionKey !== versionKey)
      .map((entry) => entry.versionKey),
  )]
    .map((key) => database.versions.find((entry) => entry.versionKey === key))
    .filter((entry): entry is ReleaseVersion => entry !== undefined);

  if (evidence.length > 0) {
    return {
      verdict: "YES",
      reasonCode: "FIXED_EXPLICIT",
      aci,
      queriedVersion: version,
      evidence,
      otherKnownFixes,
      build: requestedBuild ? build : null,
    };
  }

  const carriedEvidence = knownEvidence.filter((entry) => {
    const fixedVersion = database.versions.find(
      (candidate) => candidate.versionKey === entry.versionKey,
    );
    return fixedVersion?.releasedAt !== null
      && fixedVersion?.releasedAt !== undefined
      && version.releasedAt !== null
      && version.releasedAt !== undefined
      && fixedVersion.releasedAt < version.releasedAt;
  });
  if (carriedEvidence.length > 0) {
    return {
      verdict: "YES",
      reasonCode: "FIXED_CARRIED_FORWARD",
      aci,
      queriedVersion: version,
      evidence: carriedEvidence,
      otherKnownFixes,
      build: requestedBuild ? build : null,
    };
  }

  if (!version.complete) {
    return {
      verdict: "UNKNOWN",
      reasonCode: "VERSION_DATA_INCOMPLETE",
      aci,
      queriedVersion: version,
      evidence: [],
      otherKnownFixes,
      build,
    };
  }

  if (!database.historicalCoverageComplete) {
    return {
      verdict: "UNKNOWN",
      reasonCode: "HISTORICAL_COVERAGE_INCOMPLETE",
      aci,
      queriedVersion: version,
      evidence: [],
      otherKnownFixes,
      build,
    };
  }

  if (
    version.releasedAt === null
    || version.releasedAt === undefined
    || knownEvidence.some((entry) => {
      const fixedVersion = database.versions.find(
        (candidate) => candidate.versionKey === entry.versionKey,
      );
      return fixedVersion?.releasedAt === null
        || fixedVersion?.releasedAt === undefined;
    })
  ) {
    return {
      verdict: "UNKNOWN",
      reasonCode: "CHRONOLOGY_UNAVAILABLE",
      aci,
      queriedVersion: version,
      evidence: [],
      otherKnownFixes,
      build,
    };
  }

  return {
    verdict: "NO",
    reasonCode: "NOT_LISTED_IN_VERSION",
    aci,
    queriedVersion: version,
    evidence: [],
    otherKnownFixes,
    build,
  };
}
