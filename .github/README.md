# Rootstock Integration Tests Action

This action provides a containerized environment for running integration tests on Rootstock. 
It receives as inputs the branches of powpeg, rskj and rootstock-integration-tests repositories,
checkout at the branches passed as parameters, build the projects and run the integration tests.

The rootstock-integration-tests it's a project that tests the integration between rskj and powpeg-node, 
it validates that the peg-in and peg-out processes are working correctly. It's extremely important to both projects, 
and should be executed before any release of both projects or any merge to the master/main branch.

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