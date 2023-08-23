"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const utils_1 = require("./utils");
class MerkleTree {
    constructor(hashes) {
        this.hashes = hashes;
        this.merkleRoot = null;
    }
    getMerkleRoot() {
        if (this.merkleRoot == null) {
            const calculation = MerkleTree.reduceFrom(this.getHashes(), () => null, () => null);
            this.merkleRoot = calculation.hash;
        }
        return this.merkleRoot;
    }
    getHashes() {
        return this.hashes.slice(0);
    }
    getTxCount() {
        return this.hashes.length;
    }
    contains(hash) {
        return this.hashes.includes(hash);
    }
    reduce(leafCallback, innerCallback) {
        let calculation = MerkleTree.reduceFrom(this.getHashes(), leafCallback, innerCallback);
        return calculation.state;
    }
    static reduceFrom(hashes, leafCallback, innerCallback, currentHeight, currentOffset) {
        if (currentHeight == null || currentOffset == null) {
            currentHeight = utils_1.getMerkleTreeHeight(hashes.length);
            currentOffset = currentOffset || 0;
        }
        if (currentHeight === 0) {
            let result = {
                hash: hashes[currentOffset],
                state: null
            };
            result.state = leafCallback(result);
            return result;
        }
        let left, right;
        let leftState, rightState;
        ({ hash: left, state: leftState } = this.reduceFrom(hashes, leafCallback, innerCallback, currentHeight - 1, currentOffset * 2));
        let nextLevelWidth = utils_1.getTreeWidth(hashes.length, currentHeight - 1);
        if (currentOffset * 2 + 1 < nextLevelWidth) {
            ({ hash: right, state: rightState } = this.reduceFrom(hashes, leafCallback, innerCallback, currentHeight - 1, currentOffset * 2 + 1));
        }
        else {
            right = left;
            rightState = leftState;
        }
        let hash = utils_1.combineLeftAndRight(left, right);
        let state = innerCallback({
            hash,
            leftHash: left,
            rightHash: right,
            leftState,
            rightState
        });
        return {
            hash,
            state
        };
    }
    ;
}
exports.MerkleTree = MerkleTree;
//# sourceMappingURL=merkle-tree.js.map