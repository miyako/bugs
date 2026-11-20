import "./style.css";
import {
  type BugDatabase,
  type ResolverResult,
  resolveFixStatus,
} from "./domain";

const form = document.querySelector<HTMLFormElement>("#checker")!;
const aciInput = document.querySelector<HTMLInputElement>("#aci")!;
const versionSelect = document.querySelector<HTMLSelectElement>("#version")!;
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
const freshness = document.querySelector<HTMLElement>("#data-freshness")!;
const copyButton = document.querySelector<HTMLButtonElement>("#copy-link")!;

let database: BugDatabase;

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
      return `The official ${result.evidence[0].sourcePage} Fixed Bugs List explicitly records this ACI as fixed in ${result.queriedVersion?.displayName}.`;
    case "NOT_LISTED_IN_VERSION":
      return `This ACI is not listed on the indexed ${result.queriedVersion?.displayName} page. This applies only to that release; no other branch is inferred.`;
    case "ACI_INVALID":
      return "Enter a seven-digit ACI number. Short or ambiguous identifiers are not expanded automatically.";
    case "ACI_NOT_FOUND":
      return "This ACI does not appear in the indexed bug data, so its status cannot be determined.";
    case "VERSION_NOT_INDEXED":
      return "This release is not in the indexed dataset. No status is inferred from a newer or different release.";
    case "VERSION_DATA_INCOMPLETE":
      return `The ${result.queriedVersion?.displayName} source page has not been indexed completely. Its absence cannot be treated as evidence that the bug is not fixed.`;
  }
}

function renderResult(result: ResolverResult): void {
  resultSection.hidden = false;
  resultSection.className = `result-card verdict-${result.verdict.toLowerCase()}`;
  verdictLabel.textContent =
    result.verdict === "YES" ? "FIXED" : result.verdict === "NO" ? "NOT LISTED AS FIXED" : "UNKNOWN";
  resultTitle.textContent = `${result.aci ?? aciInput.value.trim()} · ${result.queriedVersion?.displayName ?? (versionSelect.value || "Release unavailable")}`;
  const bug = result.aci
    ? database.bugs.find((entry) => entry.aci === result.aci)
    : undefined;
  bugSummary.textContent = bug?.summary ?? "";
  bugSummary.hidden = !bug;
  verdictIcon.textContent = result.verdict === "YES" ? "✓" : result.verdict === "NO" ? "–" : "?";
  explanation.textContent = describeResult(result);
  resultEvidence.replaceChildren();

  for (const item of result.evidence) {
    const row = document.createElement("p");
    row.className = "evidence-row";
    row.textContent =
      item.evidenceType === "listed_on_version_page"
        ? "Listed in the fixed bugs for this version."
        : "Listed as “Fixed also with” in an official page.";
    addEvidenceLink(row, `View official ${item.sourcePage} source ↗`, item.sourceUrl);
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
  buildResult.textContent = result.build
    ? `Build ${result.build.buildNumber}: UNKNOWN — no authoritative build mapping is indexed. The version result above is independent.`
    : "";
  updateUrl();
}

function updateUrl(): void {
  const url = new URL(window.location.href);
  url.searchParams.set("aci", aciInput.value.trim());
  url.searchParams.set("version", versionSelect.value);
  if (buildInput.value.trim()) {
    url.searchParams.set("build", buildInput.value.trim());
  } else {
    url.searchParams.delete("build");
  }
  window.history.replaceState({}, "", url);
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!database || !versionSelect.value) return;
  renderResult(
    resolveFixStatus(database, aciInput.value, versionSelect.value, buildInput.value),
  );
});

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

async function initialize(): Promise<void> {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}data/fixed-bugs.json`);
    if (!response.ok) throw new Error(`Dataset request failed (${response.status})`);
    database = (await response.json()) as BugDatabase;

    const versions = [...database.versions].sort((a, b) =>
      a.displayName.localeCompare(b.displayName, undefined, { numeric: true }),
    );
    versionSelect.replaceChildren(new Option("Select a version", ""));
    for (const version of versions) {
      const option = new Option(
        `${version.displayName}${version.complete ? "" : " · incomplete"}`,
        version.versionKey,
      );
      versionSelect.add(option);
    }

    const query = new URLSearchParams(window.location.search);
    aciInput.value = query.get("aci") ?? "";
    buildInput.value = query.get("build") ?? "";
    const requestedVersion = query.get("version") ?? "";
    if (versions.some((version) => version.versionKey === requestedVersion)) {
      versionSelect.value = requestedVersion;
    } else if (requestedVersion) {
      versionSelect.add(new Option(`${requestedVersion} · not indexed`, requestedVersion));
      versionSelect.value = requestedVersion;
    } else {
      versionSelect.value = versions.find((version) => version.complete)?.versionKey ?? "";
    }

    versionSelect.disabled = versions.length === 0;
    submitButton.disabled = versions.length === 0;
    const completeVersions = versions.filter((version) => version.complete).length;
    loadStatus.textContent = versions.length
      ? `${completeVersions} releases fully indexed · ${versions.length - completeVersions} with partial evidence · ${database.bugs.length.toLocaleString()} bugs`
      : "No release data is available yet.";
    freshness.textContent = `Data refreshed ${new Date(database.generatedAt).toLocaleDateString()}`;

    if (query.get("aci") && query.get("version")) form.requestSubmit();
  } catch (error) {
    loadStatus.textContent =
      error instanceof Error ? `Could not load the bug dataset: ${error.message}` : "Could not load the bug dataset.";
    freshness.textContent = "Data status unavailable";
  }
}

void initialize();
