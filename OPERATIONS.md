# Operations

## Run locally

The [README](README.md#-getting-started) owns the install and build commands. Use the version in [.node-version](.node-version) and install from the npm lockfile. Vite serves the viewer locally and builds static files in `dist/`.

A clean checkout starts in Orb mode. Microphone access requires browser permission and a secure context such as localhost or HTTPS. Narration is read from a file selected on the device. Speak uses browser voices that report local synthesis. Install a local system voice if the browser exposes none.

## Optional Face mode

Use a verified, compatible FLAME mesh and its region masks that you have rights to use. Put these data-only files under `public/flame/` and reload. For a production build, supply them before building. Keep that directory out of source control.

| File | Format |
| --- | --- |
| `meta.json` | Object with positive integer `vertexCount` and `faceCount` and finite three-element `boundsMin` and `boundsMax` arrays |
| `vertices.bin` | Little-endian float32 XYZ triples in vertex order |
| `faces.bin` | Little-endian uint32 triangle triples with zero-based vertex indices |
| `regions.json` | Object mapping supported region names to zero-based vertex indices, including both internal eyeball masks |

[The loader](src/face/flameMesh.ts) owns the supported region names, checks file shapes and requests only same-origin data. An absent or invalid mesh leaves Orb mode available. The viewer ships without a converter or archives. FLAME 2023 Open has its own [upstream terms](https://flame.is.tue.mpg.de/modellicense.html). Verify the terms for the exact model and masks separately and retain any required notices before distributing them or their derivatives.

## Verify

Run `npm test`, `npm run typecheck`, and `npm run build`. In a browser, check the orb without mesh files and repeat with compatible data to exercise Face mode. Cover morph reversal, manual scrub, region hiding, drag and zoom, WebGL fallback, microphone permission and stop, narration playback and stop, and Speak/Stop with a local voice. An empty or remote-only voice list must leave Speak disabled. Check keyboard reach, focus, contrast and controls at a narrow viewport and 200 percent zoom.

## Local code scanning

Hosted Actions and scheduled dependency updates are disabled. Check dependency
updates locally with `npm outdated` and `npm audit`, then run the validation above.
Do not treat an empty alert list as a scan of newer commits.

Install the official [CodeQL bundle](https://github.com/github/codeql-action/releases)
and use a clean checkout of the commit being scanned. Keep the database and SARIF
outside the repository. From the repository root, run:

```powershell
codeql database create ../nous-codeql-db --language=javascript-typescript --source-root . --codescanning-config=.github/codeql-config.yml --threads=1 --ram=2048
codeql database analyze ../nous-codeql-db codeql/javascript-queries:codeql-suites/javascript-security-and-quality.qls --format=sarif-latest --output=../nous-codeql.sarif --threads=1 --ram=4096 --sarif-category=javascript-typescript
```

The [scan configuration](.github/codeql-config.yml) excludes generated `dist`
output and installed dependencies. Project source, tests and build configuration
remain in scope. Dependency advisories are checked separately with `npm audit`.

Inspect the results and source paths before uploading. CodeQL can include absolute
installation paths in the optional `runs[].tool.extensions[].locations` metadata.
Remove that package-location metadata before sharing; preserve findings, rules,
source locations and coverage. Check the entire report for remaining local paths.
For a scan of the current,
clean default branch, bind the upload to its exact commit:

```powershell
gh auth token | codeql github upload-results --sarif=../nous-codeql.sarif --repository=gagexhill/nous-ai --ref=refs/heads/main --commit=$(git rev-parse HEAD) --checkout-path=. --github-auth-stdin
```

Read the processed analysis in GitHub's Security and quality tab. A completed
upload alone does not establish successful processing or coverage. Re-scan after
source or dependency changes. Never print or save the authentication token.
