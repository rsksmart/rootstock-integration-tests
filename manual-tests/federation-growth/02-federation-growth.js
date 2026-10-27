const { expect } = require('chai');
const redeemScriptParser = require('@rsksmart/powpeg-redeemscript-parser');
const { getBridge } = require('../../lib/bridge-provider');
const { getRskTransactionHelpers } = require('../../lib/rsk-tx-helper-provider');
const { getBtcClient } = require('../../lib/btc-client-provider');
const { getActiveFederationInfo } = require('../../lib/federation-utils');
const { getP2shP2wshAddressFromRedeemScript } = require('../../lib/btc-utils');
const { removePrefix0x } = require('../../lib/utils');
const { ERP_PUBKEYS, ERP_CSV_VALUE } = require('../../lib/constants/federation-constants');
const { getLogger } = require('../../logger');
const { changeFederationTo } = require('../lib/federation-change-driver');
const { getStartedNodes } = require('../lib/scenario-bootstrap');
const { MAX_FEDERATORS_COUNT, getFederators } = require('../lib/federator-keys');

const logger = getLogger();

// The regtest genesis federation, which is where every run starts.
const GENESIS_FEDERATION_SIZE = 3;

// Narrow the walk while developing, e.g. MANUAL_TEST_MAX_FEDERATION_SIZE=6.
const FIRST_TARGET_SIZE = Number(process.env.MANUAL_TEST_MIN_FEDERATION_SIZE) || 4;
const LAST_TARGET_SIZE =
    Number(process.env.MANUAL_TEST_MAX_FEDERATION_SIZE) || MAX_FEDERATORS_COUNT;

// Checked here rather than left to produce no tests at all, which would start the whole network
// and then end on a nonsensical assertion over an empty result set.
if (FIRST_TARGET_SIZE > LAST_TARGET_SIZE || LAST_TARGET_SIZE > MAX_FEDERATORS_COUNT) {
    throw new Error(
        `The federation size range ${FIRST_TARGET_SIZE} to ${LAST_TARGET_SIZE} is empty or goes past the ` +
            `${MAX_FEDERATORS_COUNT} federators the pool holds. Check MANUAL_TEST_MIN_FEDERATION_SIZE and MANUAL_TEST_MAX_FEDERATION_SIZE`
    );
}

/**
 * Sizes whose federation the Bridge cannot build correctly today.
 *
 * bitcoinj-thin's `ScriptBuilder.number()` routes on `num < 16` where upstream bitcoinj uses
 * `num <= 16`, so a 16 key multisig gets its member count written as OP_PUSHBYTES_1 0x10 instead
 * of OP_16. That is a MINIMALDATA violation on the executed branch: valid inside a block, but
 * rejected by default relay policy, so the SVP spend transaction never propagates and the change
 * never completes. Every other size from 3 to 20 is encoded minimally.
 *
 * When the bitcoinj-thin fix ships, empty this list. The 16 member case will then be expected to
 * activate like the rest, and these tests will say so if it does not.
 */
const SIZES_EXPECTED_TO_FAIL = [16];

const isExpectedToFail = (federationSize) => {
    return SIZES_EXPECTED_TO_FAIL.includes(federationSize);
};

/**
 * The address a powpeg of this size should have, derived from the same public keys the Bridge is
 * given but with the javascript parser doing the encoding. Where the Bridge disagrees with this,
 * the Bridge wrote a different script.
 * @param {number} federationSize
 * @param {object} network a bitcoinjs-lib network object
 * @returns {string}
 */
const getExpectedRedeemScript = (federationSize) => {
    const publicKeys = getFederators(federationSize).map((federator) => federator.publicKey);
    return redeemScriptParser.buildPowpegRedeemScript(publicKeys, ERP_PUBKEYS, ERP_CSV_VALUE);
};

const getExpectedFederationAddress = (federationSize, network) => {
    return getP2shP2wshAddressFromRedeemScript(getExpectedRedeemScript(federationSize), network);
};

/**
 * How a powpeg of this size writes its member count, both ways.
 *
 * Up to 16 there is a single byte opcode for the number, OP_1 through OP_16, which is the only
 * minimal encoding. bitcoinj-thin's off by one makes it fall back to pushing the number as data,
 * one byte of length and one of value, which is the extra byte. From 17 up there is no opcode and
 * the data push is correct for everyone.
 * @param {number} federationSize
 * @returns {{minimal: string, nonMinimal: string}} hex, without any prefix
 */
const getMemberCountEncodings = (federationSize) => {
    return {
        minimal: (0x50 + federationSize).toString(16),
        nonMinimal: `01${federationSize.toString(16).padStart(2, '0')}`,
    };
};

/**
 * Checks a size the Bridge cannot build correctly.
 *
 * Not activating is not enough on its own: a federation change can stall for any number of
 * reasons, and a test that accepted that would go green for the wrong one. What makes this a test
 * of the encoding is the rest. The Bridge has to have given up on the proposed federation itself,
 * and the redeem script it reports in doing so has to differ from the minimally encoded one by
 * exactly the member count and nothing else.
 * @param {object} result what `changeFederationTo` reported for this size
 * @param {string} expectedAddress the address the minimal encoding gives for this size
 * @param {number} activeFederationSizeBefore the size the walk should carry on from
 */
const assertFailedOnMemberCountEncoding = (result, expectedAddress, activeFederationSizeBefore) => {
    const { targetSize } = result;

    expect(
        result.activated,
        `The ${targetSize} member federation activated. If the bitcoinj-thin fix has shipped, take ${targetSize} out of SIZES_EXPECTED_TO_FAIL`
    ).to.be.false;

    expect(
        result.proposedFederationAddress,
        `The ${targetSize} member federation failed, but the Bridge derived the same address the minimal encoding gives, so the cause is something other than the member count encoding`
    ).to.not.equal(expectedAddress);

    // The Bridge says so itself when it gives up on the proposed federation, and the event
    // carries the redeem script it built, which is the artefact under test.
    expect(
        result.failureEvent,
        result.failureEventLookupError
            ? `Could not read the commit_federation_failed event: ${result.failureEventLookupError.message}`
            : 'The Bridge never emitted commit_federation_failed, so the change stalled for some other reason'
    ).to.not.be.null;

    const bridgeRedeemScript = removePrefix0x(
        result.failureEvent.arguments.proposedFederationRedeemScript
    ).toLowerCase();
    const minimalRedeemScript = getExpectedRedeemScript(targetSize).toString('hex').toLowerCase();

    expect(
        bridgeRedeemScript,
        'The Bridge built the minimally encoded redeem script after all'
    ).to.not.equal(minimalRedeemScript);

    // OP_CHECKMULTISIG closes the multisig the member count belongs to, so anchoring on it keeps
    // this from matching the same bytes somewhere else in the script.
    const { minimal, nonMinimal } = getMemberCountEncodings(targetSize);
    expect(
        bridgeRedeemScript.replace(`${nonMinimal}ae`, `${minimal}ae`),
        `The Bridge's redeem script differs from the minimal one by more than the member count encoding, so something else is going on`
    ).to.equal(minimalRedeemScript);

    // A change that failed leaves the federation that was active untouched, so the walk carries
    // on from it rather than from the size that did not make it.
    expect(result.activeFederationSize).to.equal(activeFederationSizeBefore);

    logger.info(
        `[federation-growth] ${targetSize} members did not activate, as expected. ` +
            `The Bridge emitted commit_federation_failed with a redeem script that writes the member ` +
            `count as ${nonMinimal} instead of ${minimal}, one byte too many. ` +
            `Its address ${result.proposedFederationAddress}, minimal encoding would give ${expectedAddress}`
    );
};

describe(`Growing the powpeg from ${GENESIS_FEDERATION_SIZE} to ${LAST_TARGET_SIZE} members`, function () {
    const results = [];
    const attemptedSizes = [];
    let bridge;
    let network;

    before(async () => {
        const rskTxHelpers = getRskTransactionHelpers();
        bridge = await getBridge(rskTxHelpers[0].getClient());
        network = getBtcClient().btcConfig.network;
    });

    after(() => {
        if (results.length === 0) {
            return;
        }
        logger.info('[federation-growth] summary');
        for (const result of results) {
            logger.info(
                `[federation-growth]   ${String(result.targetSize).padStart(2)} members: ` +
                    `${result.activated ? 'activated' : 'DID NOT ACTIVATE'} at ${result.proposedFederationAddress}`
            );
        }
    });

    for (let targetSize = FIRST_TARGET_SIZE; targetSize <= LAST_TARGET_SIZE; targetSize++) {
        const expectedToFail = isExpectedToFail(targetSize);
        const title = expectedToFail
            ? `should fail to activate a ${targetSize} member federation, which bitcoinj-thin encodes non minimally`
            : `should grow the federation to ${targetSize} members`;

        it(title, async () => {
            // The active federation is whatever the last change left behind, which is not
            // targetSize - 1 once a size has failed: a failed change leaves the previous one
            // active, so the next target grows from there.
            const activeFederationInfoBefore = await getActiveFederationInfo(bridge);

            // Recorded before the call so a change that throws still counts as attempted. The
            // node count check at the end reads the largest target from here, and nodes are
            // started before anything that can throw, so losing the entry would have it compare
            // the running nodes against a smaller federation and report a problem that is not one.
            attemptedSizes.push(targetSize);

            const result = await changeFederationTo(targetSize);
            results.push(result);

            const expectedAddress = getExpectedFederationAddress(targetSize, network);

            if (expectedToFail) {
                assertFailedOnMemberCountEncoding(
                    result,
                    expectedAddress,
                    activeFederationInfoBefore.size
                );
                return;
            }

            expect(
                result.activated,
                `The ${targetSize} member federation did not activate${
                    result.failureEvent ? ', the Bridge emitted commit_federation_failed' : ''
                }`
            ).to.be.true;
            expect(result.activeFederationSize).to.equal(targetSize);
            expect(result.retired, `The federation before ${targetSize} members was not retired`).to
                .be.true;
            expect(
                result.proposedFederationAddress,
                `The Bridge derived a different address than the minimal redeem script encoding for ${targetSize} members`
            ).to.equal(expectedAddress);
        });
    }

    it('should have run only half of the largest federation attempted plus one as nodes', async () => {
        // Nodes are started for the size being attempted, not for the size that ended up active.
        // A change that fails leaves a smaller federation active but its nodes keep running, so
        // the count to check against is the largest target, not the final federation.
        const largestTargetSize = Math.max(...attemptedSizes);

        // Half plus one is spelled out here rather than taken from getRequiredSignaturesCount,
        // which is what the code being checked uses to decide how many nodes to start. Sharing
        // the function would make both sides move together, and this would still pass if the
        // threshold itself were wrong.
        const expectedNodesCount = Math.floor(largestTargetSize / 2) + 1;

        expect(
            getStartedNodes(),
            `The scenario should run ${expectedNodesCount} nodes for a largest target of ${largestTargetSize} members`
        ).to.have.lengthOf(expectedNodesCount);

        // Only for the line below; nothing here is asserted about the federation that ended up
        // active, since nodes are started for the size attempted, not the size that stuck.
        const activeFederationInfo = await getActiveFederationInfo(bridge);
        logger.info(
            `[federation-growth] finished with a ${activeFederationInfo.size} member federation, ` +
                `${expectedNodesCount} nodes running for the largest target of ${largestTargetSize} members`
        );
    });
});
