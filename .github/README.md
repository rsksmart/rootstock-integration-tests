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

### `rskj-branch`

**Optional** The rskj branch to checkout. Default is `master`.

### `powpeg-node-branch`

**Optional** The powpeg-node branch to checkout. Default is `master`.

### `rit-branch`

**Optional** The rootstock-integration-tests branch to checkout. Default is `main`.

### `rit-log-level`

**Optional** Log level for the rootstock-integration-tests. Default is `info`.

## Outputs

### `status`

The status of the integration tests.

### `message`

The output message of the integration tests.

## Example usage

```yaml
uses: docker://ghcr.io/rsksmart/rootstock-integration-tests/rit:latest
with:
  rskj-branch: master
  powpeg-node-branch: master
  rit-branch: main
```