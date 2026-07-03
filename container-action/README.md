# Rootstock Integration Tests Action

This action provides a containerized environment for running integration tests on Rootstock. 
It receives as inputs the branches of `powpeg`, `rskj` and `rootstock-integration-tests` repositories,
checkout at the branches passed as parameters, build the projects and run the integration tests.

The rootstock-integration-tests it's a project that tests the integration between rskj and powpeg-node, 
it validates that the peg-in and peg-out processes are working correctly. It's extremely important to both projects, 
and should be executed before any release of both projects or any merge to the master/main branch. 

To achieve this and make this test more accessible, we created a container-action created to execute this test, 
it offers the flexibility to run the tests with any specific tag or branch from *powpeg-node* or *rskj*. 
That way, we will add steps on each repository to run the integration tests with the version that we want to test. 
No matter if it's a tag, a branch or a specific commit.

## Inputs
By default, all the inputs are pointed to the `master/main` branch of the repositories. But, ideally, the action step
should receive the branches, commit or tag that should be tested by the pipeline execution. If we want to test
a specific tag from `powpeg-node`, the input parameter `powpeg-node-branch` should  be the tag number `6.4.0.0-rc` for example.

### `rskj-branch`

The rskj branch to checkout. If no branch or tag passed, it will be used the default `master`.

### `powpeg-node-branch`

The powpeg-node branch to checkout. If no branch or tag passed, it will be used the default `master`.

### `rit-branch`

**Optional** The rootstock-integration-tests branch to checkout. This one it's optional, if  it's needed
to use a different branch for the rootstock-integration-test. It's offered the possibility
to use a different one, but the default and most frequently used, should be `main`.

### `rit-log-level`

**Optional** Log level for the rootstock-integration-tests. Default is `info`.

## Outputs
The output of the action are basically two values, one is the status of the integration tests, and the other is the message.
I
### `status`

The status of the integration tests.  It would be `0` for success and `1` for failure.

### `message`

The output message of the integration tests. It will be:
- In case of success: `Rootstock Integration Tests Status: PASSED`
- In case of error: `Rootstock Integration Tests Status: FAILED`

## Example usage

```yaml
uses: rsksmart/rootstock-integration-tests@v1
with:
  rskj-branch: master
  powpeg-node-branch: master
  rit-branch: main
```

## Customising the branches

There are two ways to tell the integration tests which branch (or tag/commit) of
`rskj`, `powpeg-node` and `rootstock-integration-tests` to check out.

### 1. From the workflow

Pass them explicitly through the `with:` block of the action, as shown in the
example above (`rskj-branch`, `powpeg-node-branch`, `rit-branch`).

### 2. From the Pull Request description

When the tests are triggered by a pull request, the branches can be overridden
directly from the **PR description**, without touching any workflow file. This is
handled by the [`set-branch-variables`](../.github/actions/set-branch-variables/action.yml)
composite action, which scans the PR body for override tokens.

Each token must be wrapped in backticks and use the `prefix:value` format
(the backticks and the colon are both required):

- `` `rskj:<branch>` `` — the base rskj branch/tag/commit
- `` `fed:<branch>` `` — the powpeg-node branch/tag/commit (powpeg is referred to as *fed*)
- `` `rit:<branch>` `` — the rootstock-integration-tests branch/tag/commit

For example, adding the following anywhere in the PR description runs the tests
against a custom rskj branch and a specific powpeg tag, while keeping the default
`rit` branch:

```
Testing the peg-out changes.

`rskj:my-feature-branch`
`fed:6.4.0.0-rc`
```

Notes:
- Only the characters `[-+./0-9A-Z_a-z]` are allowed in the branch name.
- Any override that is omitted falls back to its default (`master` for `rskj`
  and `fed`; for `rit`, the PR's own head branch).
- To run tests against a fork/private `rskj`, set `repo-owner` (and optionally `rskj-repo`)
  and provide `github-token` when the repository is private.