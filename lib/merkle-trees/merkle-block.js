"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const strings_1 = require("../utils/strings");
const utils_1 = require("./utils");
class MerkleBlock {
    static fromBitcore(merkleRoot, merkleBlock) {
        return new MerkleBlock(merkleRoot, merkleBlock.hashes.map(strings_1.hexReverse), utils_1.flagsToBits(merkleBlock.flags), merkleBlock.numTransactions);
    }
    constructor(merkleRoot, hashes, flags, txCount) {
        this.merkleRoot = merkleRoot;
        this.hashes = hashes;
        this.flags = flags;
        this.txCount = txCount;
    }
    getMerkleRoot() {
        return this.merkleRoot;
    }
    getHashes() {
        return this.hashes.slice(0);
    }
    getFlags() {
        return this.flags;
    }
    getTxCount() {
        return this.txCount;
    }
    contains(hash) {
        return this.hashes.includes(hash);
    }
    reduce(leafCallback, innerCallback) {
        let calculation = MerkleBlock.reduceFrom(this.getTxCount(), this.getFlags(), this.getHashes(), leafCallback, innerCallback);
        if (calculation.hashes.length > 0) {
            throw new Error("Invalid partial merkle tree, hashes left without consuming after parsing");
        }
        if (calculation.flags.length >= 8 || calculation.flags.replace(/0/g, '') !== '') {
            throw new Error("Invalid partial merkle tree, flags left without consuming after parsing");
        }
        if (calculation.hash !== this.getMerkleRoot()) {
            throw new Error("Invalid partial merkle tree, computed merkle root doesn't match expected merkle root");
        }
        return calculation.state;
    }
    static reduceFrom(totalLeafs, flags, hashes, leafCallback, innerCallback, currentHeight, currentOffset) {
        if (currentHeight == null || currentOffset == null) {
            currentHeight = utils_1.getMerkleTreeHeight(totalLeafs);
            currentOffset = currentOffset || 0;
        }
        let bit = flags[0];
        flags = flags.substr(1);
        if (bit === '0' || currentHeight === 0) {
            let result = {
                hash: hashes[0],
                flags,
                hashes: hashes.slice(1),
                state: null
            };
            result.state = leafCallback(result);
            return result;
        }
        let left, right;
        let leftState, rightState;
        ({ hash: left, flags, hashes, state: leftState } = this.reduceFrom(totalLeafs, flags, hashes, leafCallback, innerCallback, currentHeight - 1, currentOffset * 2));
        let nextLevelWidth = utils_1.getTreeWidth(totalLeafs, currentHeight - 1);
        if (currentOffset * 2 + 1 < nextLevelWidth) {
            ({ hash: right, flags, hashes, state: rightState } = this.reduceFrom(totalLeafs, flags, hashes, leafCallback, innerCallback, currentHeight - 1, currentOffset * 2 + 1));
            if (left === right) {
                throw new Error("Invalid partial merkle tree, found equal hashes for left and right branches");
            }
        }
        else {
            right = left;
        }
        let hash = utils_1.combineLeftAndRight(left, right);
        let state = innerCallback({
            hash,
            leftHash: left,
            rightHash: right,
            flags,
            hashes,
            leftState,
            rightState
        });
        return {
            hash,
            flags,
            hashes,
            state
        };
    }
    ;
}
exports.MerkleBlock = MerkleBlock;
//# sourceMappingURL=merkle-block.js.map