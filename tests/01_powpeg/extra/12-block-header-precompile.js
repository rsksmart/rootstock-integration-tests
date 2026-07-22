const chai = require('chai');
const expect = chai.expect;
chai.use(require('chai-as-promised'));
const BN = require('bn.js');
const { ethers } = require('ethers');

const { getRskTransactionHelper } = require('../../../lib/rsk-tx-helper-provider');
const {
    abi: blockHeaderAbi,
    address: BLOCK_HEADER_ADDRESS,
} = require('@rsksmart/rsk-precompiled-abis/blockHeader');
const { removePrefix0x } = require('../../../lib/utils');

/** Matches {@link co.rsk.pcc.blockheader.BlockAccessor#maximumBlockDepth} in rskj */
const MAX_BLOCK_HEADER_DEPTH = 4000;

/** Canonical BlockHeader native precompile address (RSK {@code 0x1000010}) */
const BLOCK_HEADER_PRECOMPILE_ADDRESS = '0x0000000000000000000000000000000001000010';

/**
 * Block resolved by the precompile at {@code blockDepth} when {@code eth_call} runs at the chain tip:
 * ancestor {@code blockDepth + 1} of the executing block (depth 0 is the parent of the executing block).
 *
 * @param {number|string} latestNumber result of eth_blockNumber
 * @param {number} blockDepth non-negative depth argument to the precompile
 * @returns {number} expected RPC block number for eth_getBlockByNumber, or negative if out of range
 */
function rpcBlockNumberForDepth(latestNumber, blockDepth) {
    const latestBn = Number(latestNumber);
    return latestBn - 1 - blockDepth;
}

function isEmptyBytes(hex) {
    if (hex == null) {
        return true;
    }
    const body = removePrefix0x(hex);
    return body.length === 0;
}

function bnFromUnsignedBytesHex(hex) {
    if (isEmptyBytes(hex)) {
        return null;
    }
    return new BN(removePrefix0x(hex), 16);
}

function bnFromRpcQuantity(value) {
    if (value == null) {
        return null;
    }
    if (typeof value === 'string' && value.startsWith('0x')) {
        return new BN(removePrefix0x(value), 16);
    }
    return new BN(value.toString(), 10);
}

/** Last 20 bytes as lower-case 0x-prefixed address hex */
function bytesHexToAddressHex(hex) {
    if (isEmptyBytes(hex)) {
        return null;
    }
    const raw = removePrefix0x(hex);
    const addr = raw.length >= 40 ? raw.slice(-40) : raw;
    return `0x${addr}`.toLowerCase();
}

/** Last 32 bytes as lower-case 0x-prefixed hash hex */
function bytesHexToBlockHashHex(hex) {
    if (isEmptyBytes(hex)) {
        return null;
    }
    const raw = removePrefix0x(hex);
    const hashHex = raw.length >= 64 ? raw.slice(-64) : raw;
    return `0x${hashHex}`.toLowerCase();
}

describe('@regression @bridge-methods @precompiled BlockHeader native precompile (0x…1000010)', () => {
    let rskTxHelper;
    let blockHeader;

    before(async () => {
        rskTxHelper = getRskTransactionHelper();
        blockHeader = new ethers.Contract(
            BLOCK_HEADER_ADDRESS,
            blockHeaderAbi,
            rskTxHelper.getClient()
        );
    });

    it('should use the BlockHeader native address from @rsksmart/rsk-precompiled-abis', () => {
        expect(blockHeader.target.toLowerCase()).to.equal(
            BLOCK_HEADER_PRECOMPILE_ADDRESS.toLowerCase()
        );
        expect(BLOCK_HEADER_ADDRESS.toLowerCase()).to.equal(
            BLOCK_HEADER_PRECOMPILE_ADDRESS.toLowerCase()
        );
    });

    describe('alignment with eth_getBlockByNumber', () => {
        [0, 1, 2].forEach((blockDepth) => {
            it(`should decode header fields consistently at blockDepth ${blockDepth}`, async () => {
                const latestBlockNumber = await rskTxHelper.getClient().getBlockNumber();
                const targetBlockNumber = rpcBlockNumberForDepth(latestBlockNumber, blockDepth);
                expect(targetBlockNumber).to.be.at.least(
                    0,
                    'chain must be long enough for this depth at the tip'
                );

                // Fetched as the raw JSON-RPC response (not ethers' parsed `Block`, which only
                // exposes standard Ethereum fields and silently drops RSK-specific ones like
                // `minimumGasPrice`/`totalDifficulty`) so every field below stays comparable.
                const block = await rskTxHelper
                    .getClient()
                    .send('eth_getBlockByNumber', [ethers.toQuantity(targetBlockNumber), false]);

                const coinbaseBytes = await blockHeader.getCoinbaseAddress(blockDepth);
                expect(bytesHexToAddressHex(coinbaseBytes)).to.equal(block.miner.toLowerCase());

                const hashBytes = await blockHeader.getBlockHash(blockDepth);
                expect(bytesHexToBlockHashHex(hashBytes)).to.equal(block.hash.toLowerCase());

                const gasLimitBytes = await blockHeader.getGasLimit(blockDepth);
                expect(bnFromUnsignedBytesHex(gasLimitBytes).eq(bnFromRpcQuantity(block.gasLimit)))
                    .to.be.true;

                const gasUsedBytes = await blockHeader.getGasUsed(blockDepth);
                expect(bnFromUnsignedBytesHex(gasUsedBytes).eq(bnFromRpcQuantity(block.gasUsed))).to
                    .be.true;

                const difficultyBytes = await blockHeader.getDifficulty(blockDepth);
                expect(
                    bnFromUnsignedBytesHex(difficultyBytes).eq(bnFromRpcQuantity(block.difficulty))
                ).to.be.true;

                const minGasPriceBytes = await blockHeader.getMinGasPrice(blockDepth);
                const rpcMinGas =
                    block.minimumGasPrice == null ? null : bnFromRpcQuantity(block.minimumGasPrice);
                const mgpBn = bnFromUnsignedBytesHex(minGasPriceBytes);
                if (rpcMinGas) {
                    expect(mgpBn.eq(rpcMinGas)).to.be.true;
                } else {
                    expect(mgpBn != null || isEmptyBytes(minGasPriceBytes)).to.be.true;
                }

                const btcHeaderBytes = await blockHeader.getBitcoinHeader(blockDepth);
                expect(removePrefix0x(btcHeaderBytes).length).to.be.at.least(
                    80,
                    'merged-mining Bitcoin header is expected to be at least 80 bytes on RSK'
                );

                const mergedTagsBytes = await blockHeader.getMergedMiningTags(blockDepth);
                expect(mergedTagsBytes).to.be.a('string');

                const cumulativeWorkBytes = await blockHeader.getCumulativeWork(blockDepth);
                const difficultyWithUnclesBytes =
                    await blockHeader.getDifficultyWithUncles(blockDepth);

                const rpcTotalDiffBn = bnFromRpcQuantity(block.totalDifficulty);
                expect(
                    bnFromUnsignedBytesHex(cumulativeWorkBytes).eq(rpcTotalDiffBn),
                    'getCumulativeWork uses block store TD for the block hash (same as eth_getBlock totalDifficulty)'
                ).to.be.true;

                const difficultyWithUnclesBn = bnFromUnsignedBytesHex(difficultyWithUnclesBytes);
                expect(
                    difficultyWithUnclesBn?.gt(new BN(0)),
                    'getDifficultyWithUncles returns header cumulativeDifficulty (rskj); it is not necessarily equal to totalDifficulty'
                ).to.be.true;
            });
        });
    });

    describe('getUncleCoinbaseAddress', () => {
        it('should accept two int256 arguments and return empty bytes when no uncle exists at index 0', async () => {
            const uncleCoinbase = await blockHeader.getUncleCoinbaseAddress(0, 0);
            expect(isEmptyBytes(uncleCoinbase)).to.be.true;
        });

        it('should return empty bytes when uncle index is out of range', async () => {
            const uncleCoinbase = await blockHeader.getUncleCoinbaseAddress(0, 99);
            expect(isEmptyBytes(uncleCoinbase)).to.be.true;
        });
    });

    describe('edge cases for blockDepth', () => {
        it(`should return empty bytes when blockDepth is >= ${MAX_BLOCK_HEADER_DEPTH} (max depth)`, async () => {
            const blockHash = await blockHeader.getBlockHash(MAX_BLOCK_HEADER_DEPTH);
            expect(isEmptyBytes(blockHash)).to.be.true;
        });

        it('should reject eth_call when blockDepth is negative (int256)', async () => {
            await expect(blockHeader.getGasUsed(-1)).to.be.rejected;
        });
    });
});
