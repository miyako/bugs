#!/usr/bin/env bash
set -euo pipefail

ref=refs/heads/nightly-history
archive_file=nightly-fixes.json
output=src/data/nightly-fixes.json
remote_ref=$(git ls-remote --refs origin "$ref")
if [[ -n "$remote_ref" ]]; then
    git fetch --no-tags --depth=1 origin "$ref"
    tip=$(git rev-parse FETCH_HEAD)
    archive=$(mktemp)
    trap 'rm -f -- "$archive"' EXIT
    git show "$tip:$archive_file" > "$archive"
    python3 -m scripts.build_nightly_data --archive "$archive"
else
    python3 -m scripts.build_nightly_data
fi

if [[ "${1:-}" == "--publish" ]]; then
    blob=$(git hash-object -w -- "$output")
    if [[ -n "$remote_ref" ]] && [[ "$blob" == "$(git rev-parse "$tip:$archive_file")" ]]; then
        exit 0
    fi
    tree=$(printf '100644 blob %s\t%s\n' "$blob" "$archive_file" | git mktree)
    publish_commit() {
        git -c user.name='github-actions[bot]' \
            -c user.email='41898282+github-actions[bot]@users.noreply.github.com' \
            commit-tree "$tree" "$@" -m 'Preserve nightly fix observations'
    }
    if [[ -n "$remote_ref" ]]; then
        commit=$(publish_commit -p "$tip")
    else
        commit=$(publish_commit)
    fi
    git -c credential.helper= -c 'credential.helper=!gh auth git-credential' push origin "$commit:$ref"
fi
