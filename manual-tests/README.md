# Manual tests

Scenarios that are too heavy, too slow or too specialised to belong in the regular suite, and
that are started by hand when somebody wants to answer a specific question.

They live here, outside `tests/`, for one reason: `test.js` registers `./tests/**/*.js`, so
anything in this folder is invisible to it. Neither `npm run test-short` nor `npm run test-long`
can pick these up, with no filters or tags to maintain.

Regtest only.

## Running one

```bash
npm run test-manual
```

lists the scenarios. To run one:

```bash
npm run test-manual <scenario>
```

A scenario can take a long time and can run a lot of nodes.

Only one run of a given scenario at a time: a run takes a lock on its own folder under
`manual-tests/generated/`, and refuses to start if another one holds it. A lock left behind by a
process that is gone is taken over automatically.

## Adding a scenario

Create a folder next to the existing ones with:

- **`scenario.js`** — the manifest. Its presence is what makes the folder a scenario. See
  `harness-check/scenario.js` for the fields; only `description` is required.
- **spec files whose names start with a number** — `01-...js`, `02-...js`, run in that order,
  the same convention used under `tests/`. Any other `.js` file in the folder is support code
  and is not run.

A scenario may also bring its own node configuration (`configFile`) and its own root level
before/after hooks (`bootstrapFile`); the runner wires both up.

## Scenarios

- **`harness-check`** — checks this harness itself. Starts no nodes, finishes in seconds. Copy it
  as the template for a new scenario.

  Its checks live in `lib/harness-checks.js` and the runner makes them before every invocation of
  any scenario, so a scenario folder with no manifest, or one with no numbered spec files, is
  refused with a message instead of being silently ignored. This scenario is how to exercise them
  on their own.
- **`federation-growth`** — grows the powpeg from the 3 member regtest genesis federation up to
  20 members, one real Bridge federation change at a time, each with its own SVP, activation,
  migration and retirement. About an hour and a half on a developer laptop, ending with 11
  nodes running.

  Every size from 3 to 20 activates except 16, which is expected to fail: bitcoinj-thin writes a
  16 key multisig's member count as `OP_PUSHBYTES_1 0x10` instead of `OP_16`, one byte too many,
  and the resulting script is valid in a block but not relayable. The test requires the Bridge to
  emit `commit_federation_failed` for that size and checks the redeem script the event carries
  differs from the minimally encoded one by exactly that byte. **When the bitcoinj-thin fix
  ships, empty `SIZES_EXPECTED_TO_FAIL` in `02-federation-growth.js`**; 16 is then expected to
  activate like the rest, and the test says so if it does not.

  The range is configurable, and the first target is reached from whatever federation is active
  rather than one step at a time, so a narrow range still starts from the genesis federation:

  ```bash
  # 3 -> 15 in one change, then 16 through 20. Six changes instead of seventeen.
  MANUAL_TEST_MIN_FEDERATION_SIZE=15 npm run test-manual federation-growth

  # One change, 3 -> 16, to exercise just the failing size.
  MANUAL_TEST_MIN_FEDERATION_SIZE=16 MANUAL_TEST_MAX_FEDERATION_SIZE=16 npm run test-manual federation-growth
  ```

## Notes

Everything a scenario materialises at run time - federator key files, its own bitcoin data
directory, the lock - lives under `manual-tests/generated/`, which is gitignored. The bitcoin
data directory is cleared at the start of every run, so a scenario always begins on a fresh
chain; `cleanEnv.js` does not know about it.

The runner uses mocha's `spec` reporter only. The repository's `.mocharc.json` also writes
`reports/junit.xml`, which belongs to the CI suite, and a manual run should not overwrite it.
