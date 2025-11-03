"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const crypto = require('bitcoinjs-lib').crypto;
exports.combineLeftAndRight = (left, right) => {
    let bufLeft = Buffer.from(left, 'hex');
    let bufRight = Buffer.from(right, 'hex');
    bufLeft.reverse();
    bufRight.reverse();
    let combinedHashesBuffer = Buffer.concat([bufLeft, bufRight]);
    // double sha256
    let bufHashed = crypto.hash256(combinedHashesBuffer);
    bufHashed.reverse();
    return bufHashed.toString('hex');
};
exports.getMerkleTreeHeight = (leafCount) => {
    if (leafCount <= 0)
        throw new Error("Number of leaves must be greater than zero");
    return Math.ceil(Math.log2(leafCount));
};
exports.getTreeWidth = (leafCount, height) => {
    return (leafCount + (1 << height) - 1) >> height;
};
exports.flagsToBits = (flags) => {
    let bits = '';
    for (const flag of flags) {
        bits += reverse(zeroes(8 - flag.toString(2).length) + flag.toString(2));
    }
    return bits;
};
exports.zeroes = (n) => n <= 0 ? '' : `0${exports.zeroes(n - 1)}`;
exports.reverse = (s) => Buffer.from(s).reverse().toString();
exports.hexReverse = (s) => {
    const buf = Buffer.from(s, 'hex');
    buf.reverse();
    return buf.toString('hex');
};
//# sourceMappingURL=utils.js.map