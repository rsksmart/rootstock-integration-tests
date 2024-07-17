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
By default, all the inputs are pointed to the `master/main` branch of the repositories. But, ideally, we will adapt
the action to receive the branches  received to be the one in a branch or tag that we want to test.

### `rskj-branch`

The rskj branch to checkout. If no branch or tag passed, it will be used the default `master`.

### `powpeg-node-branch`

The powpeg-node branch to checkout. If no branch or tag passed, it will be used the default `master`.

### `rit-branch`

**Optional** The rootstock-integration-tests branch to checkout. This one it's optional, because it will be
very unlikely that we need to use a different branch for the rootstock-integration-test. It's offered the possibility
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
uses: docker://ghcr.io/rsksmart/rootstock-integration-tests/rit:latest
with:
  rskj-branch: master
  powpeg-node-branch: master
  rit-branch: main
```