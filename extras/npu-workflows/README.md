# NPU workflows (parked)

Moved here from `.github/parked-workflows/`. GitHub only runs workflows in
`.github/workflows/`, so nothing here runs or
shows up in the Actions list. They are kept for when NPU work resumes on a
newer phone (see issue #1 and "Deferred — NPU acceleration" in
`TODO.md`).

- `*hexagon*`, `*v69*`, `*qnn*`, `audit-v69-*`: Hexagon / QNN / FastRPC
  experiments for the Snapdragon 7 Gen 1 (V69) test phone.
- `api-helper-diagnostic.yml`: the older "API Helper" build, superseded by
  `pocketagent-integration-apk.yml`.

To use one again, move it back into `.github/workflows/` and adjust the
SDK versions and target for the new phone.
