# Security Policy

## Reporting a vulnerability

Please use [private vulnerability reporting](https://github.com/gagexhill/nous-ai/security/advisories/new).
Include the affected commit, browser and operating system, reproduction steps, and
expected and observed behavior. Use synthetic data. Do not attach credentials,
private recordings, or personal information.

The latest default branch is supported. Report ordinary bugs and feature requests
through [Issues](https://github.com/gagexhill/nous-ai/issues).

## System and scope

Nous is a standalone browser viewer with no account, backend, cloud deployment,
or assistant connection. This repository covers its source, dependencies, and
local build tooling. Optional face data has separate licensing requirements in
[Operations](OPERATIONS.md#optional-face-mode).

## Trust boundaries and required properties

- Microphone access requires browser permission. Stop and input replacement must
  release owned audio sources and microphone tracks.
- Narration files stay in the browser. Temporary file URLs must be revoked when
  their input is replaced or stopped.
- Speech must select a voice that explicitly reports local synthesis. Empty or
  remote-only voice inventories must not create speech utterances.
- Optional mesh files are same-origin, data-only inputs. Their structure, sizes,
  indices and region masks must be checked before rendering.
- Credentials, private recordings and optional user assets stay out of Git.

Treat selected media and mesh data as untrusted inputs. Report reachable failures
of these properties, unintended data transmission, unsafe parsing, and dependency
vulnerabilities with their concrete impact. There are no blanket finding-class
exclusions or severity downgrades.

## Verification limits

A successful static build does not establish microphone behavior, local voice
availability, driver compatibility, or graphics performance on every device.
Reports should identify the actual browser and device used. Repository settings
and scanner results do not replace runtime testing.
