import "./style.css";
import nightlyFixes from "./data/nightly-fixes.json";
import nightlyRefresh from "./data/nightly-refresh.json";
import {
  type BugDatabase,
  type ResolverResult,
  chronologyDate,
  dataFreshness,
  findFixHistory,
  nightlyBranch,
  resolveFixStatus,
} from "./domain";

const form = document.querySelector<HTMLFormElement>("#checker")!;
const aciInput = document.querySelector<HTMLInputElement>("#aci")!;
const versionSearchInput = document.querySelector<HTMLInputElement>("#version-search")!;
const versionSelect = document.querySelector<HTMLSelectElement>("#version")!;
const versionOptions = document.querySelector<HTMLUListElement>("#version-options")!;
const versionSearchStatus = document.querySelector<HTMLParagraphElement>("#version-search-status")!;
const buildInput = document.querySelector<HTMLInputElement>("#build")!;
const submitButton = document.querySelector<HTMLButtonElement>("#submit")!;
const loadStatus = document.querySelector<HTMLParagraphElement>("#load-status")!;
const resultSection = document.querySelector<HTMLElement>("#result")!;
const resultTitle = document.querySelector<HTMLHeadingElement>("#result-title")!;
const bugSummary = document.querySelector<HTMLParagraphElement>("#bug-summary")!;
const verdictLabel = document.querySelector<HTMLElement>("#verdict-label")!;
const verdictIcon = document.querySelector<HTMLElement>("#verdict-icon")!;
const explanation = document.querySelector<HTMLParagraphElement>("#result-explanation")!;
const resultEvidence = document.querySelector<HTMLDivElement>("#result-evidence")!;
const buildResult = document.querySelector<HTMLDivElement>("#build-result")!;
const releaseFreshness = document.querySelector<HTMLElement>("#release-freshness")!;
const nightlyFreshness = document.querySelector<HTMLElement>("#nightly-freshness")!;
const copyButton = document.querySelector<HTMLButtonElement>("#copy-link")!;
const nightlySource = document.querySelector<HTMLAnchorElement>("#nightly-source")!;
const releaseSource = document.querySelector<HTMLAnchorElement>("#release-source")!;

let database: BugDatabase;
let visibleVersions: BugDatabase["versions"] = [];
let activeVersionIndex = -1;

const MAX_VERSION_RESULTS = 8;

function versionLabel(version: BugDatabase["versions"][number]): string {
  return `${version.displayName}${version.complete ? "" : " · incomplete"}`;
}

function compareVersionsByDate(
  first: BugDatabase["versions"][number],
  second: BugDatabase["versions"][number],
): number {
  const firstDate = chronologyDate(first);
  const secondDate = chronologyDate(second);
  if (firstDate && secondDate) {
    const dateOrder = secondDate.localeCompare(firstDate);
    if (dateOrder !== 0) return dateOrder;
  } else if (firstDate) {
    return -1;
  } else if (secondDate) {
    return 1;
  }
  return second.displayName.localeCompare(first.displayName, undefined, { numeric: true });
}

function addEvidenceLink(container: HTMLElement, label: string, url: string): void {
  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = label;
  container.append(link);
}

function describeResult(result: ResolverResult): string {
  switch (result.reasonCode) {
    case "FIXED_EXPLICIT":
      return `The official ${result.evidence[0].sourcePage} Fixed Bugs List explicitly records this ACI as fixed in ${database.versions.find((version) => version.versionKey === result.evidence[0].versionKey)?.displayName ?? result.evidence[0].versionKey}.`;
    case "FIXED_CARRIED_FORWARD": {
      const fixedVersion = database.versions.find(
        (version) => version.versionKey === result.evidence[0].versionKey,
      );
      const target = result.queriedVersion;
      const listing = `The official ${result.evidence[0].sourcePage} Fixed Bugs List records this ACI as fixed in ${fixedVersion?.displayName ?? result.evidence[0].versionKey}.`;
      if ((!fixedVersion?.releasedAt && fixedVersion?.installerCreatedAt)
        || (!target?.releasedAt && target?.installerCreatedAt)) {
        return `${listing} Using 4D installer creation dates where release dates are unknown, ${chronologyDate(fixedVersion)} is earlier than ${target?.displayName} (${chronologyDate(target)}), so the fix carries forward.`;
      }
      return `${listing} Its release date (${fixedVersion?.releasedAt}) is earlier than ${target?.displayName}, so the fix carries forward.`;
    }
    case "NOT_LISTED_IN_VERSION":
      return `This ACI is not listed in the indexed release history through ${result.queriedVersion?.displayName}.`;
    case "ACI_INVALID":
      return "Enter a seven-digit ACI number. Short or ambiguous identifiers are not expanded automatically.";
    case "ACI_NOT_FOUND":
      return "This ACI does not appear in the indexed release data, so its release status cannot be determined.";
    case "VERSION_NOT_INDEXED":
      return "This release is not in the indexed dataset. No status is inferred from a newer or different release.";
    case "VERSION_DATA_INCOMPLETE":
      return `The ${result.queriedVersion?.displayName} source page has not been indexed completely. Its absence cannot be treated as evidence that the bug is not fixed.`;
    case "HISTORICAL_COVERAGE_INCOMPLETE":
      return `The ${result.queriedVersion?.displayName} page is complete, but older release history is not fully indexed. An older fix may carry forward, so absence is inconclusive.`;
    case "CHRONOLOGY_UNAVAILABLE":
      return "A known fix exists, but official release chronology is unavailable for comparison with the requested version.";
  }
}

function showBugSummary(aci: string | null): void {
  const bug = database.bugs.find((entry) => entry.aci === aci);
  bugSummary.textContent = bug?.summary ?? "";
  bugSummary.hidden = !bug;
}

function renderHistory(aciInputValue: string): void {
  const { aci, releases, nightlies } = findFixHistory(database, aciInputValue, nightlyFixes);
  const found = releases.length > 0 || nightlies.length > 0;
  resultSection.hidden = false;
  resultSection.className = `result-card verdict-${found ? "yes" : "unknown"}`;
  resultTitle.textContent = aci ?? aciInputValue.trim();
  verdictLabel.textContent = found ? "FIXES FOUND" : aci ? "NO DATA" : "INVALID ACI";
  verdictIcon.textContent = found ? "✓" : "?";
  showBugSummary(aci);
  explanation.textContent = found
    ? "Official listings report fixes in the releases or builds below."
    : aci
      ? "No fix is listed for this ACI in the indexed release or nightly data."
      : "Enter a seven-digit ACI number, with or without “ACI”.";
  buildResult.hidden = true;
  buildResult.replaceChildren();
  resultEvidence.replaceChildren();

  const versions = new Map(database.versions.map((version) => [version.versionKey, version.displayName]));
  for (const fix of releases) {
    const row = document.createElement("p");
    row.className = "evidence-row";
    row.textContent = `Release: ${versions.get(fix.versionKey) ?? fix.versionKey}. `;
    addEvidenceLink(row, `View official ${fix.sourcePage} source ↗`, fix.sourceUrl);
    resultEvidence.append(row);
  }
  for (const fix of nightlies) {
    const row = document.createElement("p");
    row.className = "evidence-row";
    row.textContent = `4D ${fix.branch.replace("_", " ")} nightly branch: first indexed fix in build ${fix.buildNumber}. `;
    addEvidenceLink(row, "View official build list ↗", fix.sourceUrl);
    resultEvidence.append(row);
  }
  updateUrl();
}

function renderResult(result: ResolverResult): void {
  resultSection.hidden = false;
  resultSection.className = `result-card verdict-${result.verdict.toLowerCase()}`;
  verdictLabel.textContent =
    result.verdict === "YES" ? "FIXED" : result.verdict === "NO" ? "NOT LISTED AS FIXED" : "UNKNOWN";
  resultTitle.textContent = `${result.aci ?? aciInput.value.trim()} · ${result.queriedVersion?.displayName ?? (versionSelect.value || "Release unavailable")}`;
  showBugSummary(result.aci);
  verdictIcon.textContent = result.verdict === "YES" ? "✓" : result.verdict === "NO" ? "–" : "?";
  explanation.textContent = describeResult(result);
  resultEvidence.replaceChildren();

  for (const item of result.evidence) {
    const row = document.createElement("p");
    row.className = "evidence-row";
    const fixedVersion = database.versions.find(
      (version) => version.versionKey === item.versionKey,
    );
    row.textContent =
      item.evidenceType === "listed_on_version_page"
        ? `Listed as fixed in ${fixedVersion?.displayName ?? item.versionKey}.`
        : `Listed as “Fixed also with” ${fixedVersion?.displayName ?? item.versionKey} in an official page.`;
    addEvidenceLink(row, `View official ${item.sourcePage} source ↗`, item.sourceUrl);
    if (result.reasonCode === "FIXED_CARRIED_FORWARD" && fixedVersion?.releaseDateSource) {
      addEvidenceLink(
        row,
        `Verify ${fixedVersion.displayName} release date ↗`,
        fixedVersion.releaseDateSource,
      );
    } else if (result.reasonCode === "FIXED_CARRIED_FORWARD" && fixedVersion?.installerDateSource) {
      addEvidenceLink(row, `View ${fixedVersion.displayName} installer date ↗`, fixedVersion.installerDateSource);
    }
    resultEvidence.append(row);
  }

  const target = result.queriedVersion;
  if (result.reasonCode === "FIXED_CARRIED_FORWARD" && target?.installerDateSource && !target.releasedAt) {
    const row = document.createElement("p");
    row.className = "evidence-row";
    addEvidenceLink(row, `View ${target.displayName} installer date ↗`, target.installerDateSource);
    resultEvidence.append(row);
  }

  if (result.evidence.length === 0 && result.queriedVersion) {
    const page = database.sourcePages.find(
      (entry) => entry.versionKey === result.queriedVersion?.versionKey,
    );
    if (page) {
      const row = document.createElement("p");
      row.className = "evidence-row";
      row.textContent = `Checked ${page.recordCount} bug entries from the official source. `;
      addEvidenceLink(row, `Open source page ↗`, page.url);
      resultEvidence.append(row);
    }
  }

  if (result.otherKnownFixes.length > 0) {
    const other = document.createElement("p");
    other.className = "evidence-row other-fixes";
    other.textContent = `Other versions with explicit fix evidence: ${result.otherKnownFixes
      .map((version) => version.displayName)
      .join(", ")}.`;
    resultEvidence.append(other);
  }

  buildResult.hidden = result.build === null;
  buildResult.replaceChildren();
  if (result.build?.verdict === "YES") {
    const fix = result.build.evidence;
    buildResult.textContent = `Build ${result.build.buildNumber}: FIXED on the ${fix.branch} nightly branch — first listed at build ${fix.buildNumber}. The release result above is independent. `;
    addEvidenceLink(buildResult, "View official build list ↗", fix.sourceUrl);
  } else if (result.build?.reasonCode === "FIX_LISTED_LATER") {
    const { buildNumber, evidence, releaseBuildSource } = result.build;
    const anchor = releaseBuildSource
      ? `${result.queriedVersion?.displayName} (build ${buildNumber})`
      : `Build ${buildNumber}`;
    buildResult.textContent = `${anchor}: not yet listed as fixed. The first indexed fix on this branch is in build ${evidence.buildNumber}. `;
    addEvidenceLink(buildResult, "View official build list ↗", evidence.sourceUrl);
    if (releaseBuildSource) {
      buildResult.append(" · ");
      addEvidenceLink(buildResult, "Verify release build ↗", releaseBuildSource);
    }
  } else if (result.build) {
    buildResult.textContent = `Build ${result.build.buildNumber}: UNKNOWN — no indexed fix at or before this build on the selected branch. The release result above is independent.`;
  }
  updateUrl();
}

function updateUrl(): void {
  const url = new URL(window.location.href);
  url.searchParams.set("aci", aciInput.value.trim());
  if (versionSelect.value) {
    url.searchParams.set("version", versionSelect.value);
  } else {
    url.searchParams.delete("version");
  }
  if (versionSelect.value && buildInput.value.trim()) {
    url.searchParams.set("build", buildInput.value.trim());
  } else {
    url.searchParams.delete("build");
  }
  window.history.replaceState({}, "", url);
}

function updateSourceLinks(): void {
  const version = database.versions.find(
    (entry) => entry.versionKey === versionSelect.value,
  );
  if (!version) {
    nightlySource.hidden = true;
    releaseSource.hidden = true;
    return;
  }

  const branch = nightlyBranch(version);
  const nightlyName = nightlySource.querySelector("span");
  const releaseName = releaseSource.querySelector("span");
  nightlySource.href = `https://developer.4d.com/FixedBugsList/nightly/${branch}/`;
  releaseSource.href = `https://developer.4d.com/FixedBugsList/versions/${version.officialSlug}/`;
  nightlySource.hidden = false;
  releaseSource.hidden = false;
  if (nightlyName) nightlyName.textContent = branch;
  if (releaseName) releaseName.textContent = version.officialSlug;
}

function updateVersionContext(): void {
  buildInput.disabled = !versionSelect.value;
  if (buildInput.disabled) buildInput.value = "";
  updateSourceLinks();
}

function closeVersionOptions(): void {
  versionOptions.hidden = true;
  versionSearchInput.setAttribute("aria-expanded", "false");
  versionSearchInput.removeAttribute("aria-activedescendant");
  activeVersionIndex = -1;
}

function setActiveVersion(index: number): void {
  if (index < 0 || index >= visibleVersions.length) return;
  activeVersionIndex = index;
  const options = versionOptions.querySelectorAll<HTMLElement>('[role="option"]');
  options.forEach((option, optionIndex) => {
    option.classList.toggle("is-active", optionIndex === activeVersionIndex);
  });
  const activeOption = options[activeVersionIndex];
  if (activeOption) {
    versionSearchInput.setAttribute("aria-activedescendant", activeOption.id);
    activeOption.scrollIntoView({ block: "nearest" });
  }
}

function selectVersion(version: BugDatabase["versions"][number]): void {
  if (versionSelect.value !== version.versionKey) buildInput.value = "";
  versionSelect.value = version.versionKey;
  versionSearchInput.value = versionLabel(version);
  versionSearchInput.setCustomValidity("");
  closeVersionOptions();
  versionSelect.dispatchEvent(new Event("change", { bubbles: true }));
}

function exactVersionMatch() {
  const query = versionSearchInput.value.trim().toLowerCase();
  return database.versions.find((version) =>
    [version.displayName, version.versionKey, version.officialSlug, versionLabel(version)]
      .some((value) => value.toLowerCase() === query),
  );
}

function renderVersionOptions(query = versionSearchInput.value): void {
  const normalizedQuery = query.trim().toLowerCase();
  const matches = database.versions
    .filter((version) =>
      `${versionLabel(version)} ${version.versionKey} ${version.officialSlug}`
        .toLowerCase()
        .includes(normalizedQuery),
    )
    .sort(compareVersionsByDate);
  visibleVersions = matches.slice(0, MAX_VERSION_RESULTS);
  activeVersionIndex = -1;
  versionSearchInput.removeAttribute("aria-activedescendant");
  versionOptions.replaceChildren();

  visibleVersions.forEach((version, index) => {
    const option = document.createElement("li");
    option.id = `version-option-${index}`;
    option.className = "version-option";
    option.setAttribute("role", "option");
    option.setAttribute(
      "aria-selected",
      version.versionKey === versionSelect.value ? "true" : "false",
    );
    option.setAttribute("aria-label", versionLabel(version));

    const name = document.createElement("span");
    name.textContent = version.displayName;
    const status = document.createElement("span");
    status.className = "version-option-status";
    status.textContent = version.complete ? "Indexed" : "Incomplete";
    option.append(name, status);
    option.addEventListener("mousedown", (event) => event.preventDefault());
    option.addEventListener("click", () => selectVersion(version));
    option.addEventListener("pointermove", () => setActiveVersion(index));
    versionOptions.append(option);
  });

  versionOptions.hidden = visibleVersions.length === 0;
  versionSearchInput.setAttribute("aria-expanded", String(!versionOptions.hidden));
  versionSearchStatus.textContent = matches.length === 0
    ? "No matching versions."
    : matches.length > MAX_VERSION_RESULTS
    ? `Showing ${MAX_VERSION_RESULTS} of ${matches.length} matches. Keep typing to narrow the list.`
    : `${matches.length} matching ${matches.length === 1 ? "version" : "versions"}.`;

  const selectedIndex = visibleVersions.findIndex(
    (version) => version.versionKey === versionSelect.value,
  );
  if (selectedIndex >= 0 && normalizedQuery === "") setActiveVersion(selectedIndex);
}

versionSearchInput.addEventListener("focus", () => {
  versionSearchInput.select();
  renderVersionOptions("");
});
versionSearchInput.addEventListener("input", () => {
  versionSelect.value = "";
  versionSearchInput.setCustomValidity("");
  updateVersionContext();
  renderVersionOptions();
});
versionSearchInput.addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    if (versionOptions.hidden) renderVersionOptions();
    if (visibleVersions.length > 0) {
      setActiveVersion(
        activeVersionIndex < 0
          ? 0
          : Math.min(activeVersionIndex + 1, visibleVersions.length - 1),
      );
    }
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    if (versionOptions.hidden) renderVersionOptions();
    if (visibleVersions.length > 0) {
      setActiveVersion(
        activeVersionIndex < 0
          ? visibleVersions.length - 1
          : Math.max(activeVersionIndex - 1, 0),
      );
    }
  } else if (event.key === "Enter" && !versionOptions.hidden) {
    const selected = visibleVersions[activeVersionIndex]
      ?? exactVersionMatch()
      ?? (visibleVersions.length === 1 ? visibleVersions[0] : undefined);
    if (selected) {
      event.preventDefault();
      selectVersion(selected);
    }
  } else if (event.key === "Escape" && !versionOptions.hidden) {
    event.preventDefault();
    closeVersionOptions();
  }
});
versionSearchInput.addEventListener("blur", (event) => {
  if (event.relatedTarget === submitButton) return;
  window.setTimeout(() => {
    if (document.activeElement !== versionSearchInput) closeVersionOptions();
  }, 100);
});
submitButton.addEventListener("blur", closeVersionOptions);

form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!database) return;
  if (!versionSelect.value && versionSearchInput.value.trim()) {
    const version = exactVersionMatch();
    if (!version) {
      versionSearchInput.setCustomValidity("Select a matching version or leave this field blank.");
      versionSearchInput.reportValidity();
      return;
    }
    selectVersion(version);
  }
  closeVersionOptions();
  if (!versionSelect.value) {
    renderHistory(aciInput.value);
    return;
  }
  renderResult(
    resolveFixStatus(database, aciInput.value, versionSelect.value, buildInput.value, nightlyFixes),
  );
});

versionSelect.addEventListener("change", updateVersionContext);

copyButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(window.location.href);
    copyButton.textContent = "Copied";
    window.setTimeout(() => (copyButton.textContent = "Copy link"), 1600);
  } catch {
    copyButton.textContent = "Copy unavailable";
    window.setTimeout(() => (copyButton.textContent = "Copy link"), 1600);
  }
});

function renderFreshness(element: HTMLElement, label: string, timestamp: string | null): void {
  const status = dataFreshness(timestamp);
  element.dataset.stale = String(status === "overdue");
  if (!timestamp || status === "unavailable") {
    element.textContent = `${label}: refresh date unavailable`;
    return;
  }
  const time = document.createElement("time");
  time.dateTime = timestamp;
  time.title = timestamp;
  time.textContent = new Date(timestamp).toLocaleDateString();
  element.replaceChildren(`${label} checked `, time, status === "overdue" ? " (overdue)" : "");
}

async function initialize(): Promise<void> {
  renderFreshness(nightlyFreshness, "Nightly lists", nightlyRefresh.refreshedAt);
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}data/fixed-bugs.json`);
    if (!response.ok) throw new Error(`Dataset request failed (${response.status})`);
    database = (await response.json()) as BugDatabase;

    const versions = [...database.versions].sort(compareVersionsByDate);
    versionSelect.replaceChildren(new Option("Select a version", ""));
    for (const version of versions) {
      versionSelect.add(new Option(versionLabel(version), version.versionKey));
    }

    const query = new URLSearchParams(window.location.search);
    aciInput.value = query.get("aci") ?? "";
    buildInput.value = query.get("build") ?? "";
    const requestedVersion = query.get("version") ?? "";
    const indexedRequestedVersion = versions.find(
      (version) => version.versionKey === requestedVersion,
    );
    if (indexedRequestedVersion) {
      versionSelect.value = requestedVersion;
      versionSearchInput.value = versionLabel(indexedRequestedVersion);
    } else if (requestedVersion) {
      versionSelect.add(new Option(`${requestedVersion} · not indexed`, requestedVersion));
      versionSelect.value = requestedVersion;
      versionSearchInput.value = `${requestedVersion} · not indexed`;
    }

    versionSelect.disabled = versions.length === 0;
    versionSearchInput.disabled = versions.length === 0;
    submitButton.disabled = false;
    const completeVersions = versions.filter((version) => version.complete).length;
    loadStatus.textContent = versions.length
      ? `${completeVersions} releases fully indexed · ${versions.length - completeVersions} with partial evidence · ${database.bugs.length.toLocaleString()} bugs`
      : "No release data is available yet.";
    renderFreshness(releaseFreshness, "Release lists", database.generatedAt);
    updateVersionContext();

    if (query.get("aci")) form.requestSubmit();
  } catch (error) {
    loadStatus.textContent =
      error instanceof Error ? `Could not load the bug dataset: ${error.message}` : "Could not load the bug dataset.";
    renderFreshness(releaseFreshness, "Release lists", null);
  }
}

void initialize();
