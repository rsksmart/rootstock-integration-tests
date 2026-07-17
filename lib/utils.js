var fs = require('fs-extra');
const RLP = require('rlp');
const Web3 = require('web3');

var wait = (msec) => new Promise((resolve) => setTimeout(resolve, msec));

const ensure0x = (value) => (value.substr(0, 2) == '0x' ? value : `0x${value}`);

const removePrefix0x = (hash) => (hash.startsWith('0x') ? hash.substring(2) : hash);

const removeDir = (folder) => {
    let path = require('node:path');
    let isDir = fs.statSync(folder).isDirectory();

    if (!isDir) {
        return;
    }

    let files = fs.readdirSync(folder);

    if (files.length > 0) {
        for (const file of files) {
            let fullPath = path.join(folder, file);
            removeDir(fullPath);
        }

        files = fs.readdirSync(folder);
    }

    if (files.length == 0) {
        fs.rmdirSync(folder);
        return;
    }
};

const getAdditionalFederationAddresses = () =>
    [].concat(global.Runners.common.additionalFederationAddresses);

const addAdditionalFederationAddress = (address) => {
    if (!global.Runners.common.additionalFederationAddresses.includes(address)) {
        global.Runners.common.additionalFederationAddresses.push(address);
    }
};

const removeAdditionalFederationAddress = (address) => {
    global.Runners.common.additionalFederationAddresses =
        global.Runners.common.additionalFederationAddresses.filter((e) => e != address);
};

/**
 *
 * @param {function} method function to execute
 * @param {function} check callback function to check the result of the method.
 * If this callback returns true, then the method call is considered successful and the result is returned.
 * Otherwise, the method is executed again.
 * @param {number} maxAttempts defaults to 3
 * @param {number} delayInMilliseconds defaults to 500 milliseconds
 * @param {function} onError Optional, defaults to null. Callback function for the caller to check the thrown error. If the callback returns true, then the function will stop executing.
 * If this callback is not provided, then the error will be thrown.
 * @returns {Promise<any>} the result of the method call or the last value of `result` after the attempts.
 */
const retryWithCheck = async (
    method,
    check,
    maxAttempts = 16,
    delayInMilliseconds = 500,
    onError = null
) => {
    let currentAttempts = 1;
    let result;
    while (currentAttempts <= maxAttempts) {
        try {
            result = await method();
            if (!check || (await check(result, currentAttempts))) {
                return {
                    result,
                    attempts: currentAttempts,
                };
            }
            await wait(delayInMilliseconds);
            currentAttempts++;
        } catch (e) {
            if (!onError) {
                throw e;
            }
            if (await onError(e)) {
                break;
            }
        }
    }
    return {
        result,
        attempts: currentAttempts,
    };
};

/**
 * Splits a given string into chunks of specified length.
 *
 * @param {string} inputString - The string to be split into smaller chunks.
 * @param {number} chunkSize - The length of each chunk.
 * @returns {string[]} An array of strings, each containing a segment of the input string,
 *                     with a maximum length of `chunkSize`. If the input string's length
 *                     is not divisible by `chunkSize`, the last chunk may be shorter.
 *
 * @example
 * splitStringIntoChunks("Hello World!", 5);
 * // returns ["Hello", " Worl", "d!"]
 *
 * @throws {TypeError} If chunkSize is less than 1 or not a number.
 */
function splitStringIntoChunks(inputString, chunkSize) {
    if (!Number.isInteger(chunkSize) || chunkSize < 1) {
        throw new TypeError('chunkSize must be a positive number.');
    }

    // Use the chunk size in the regular expression to match segments of the given length
    const regex = new RegExp(`.{1,${chunkSize}}`, 'g');
    const matches = [];
    let match;
    while ((match = regex.exec(inputString)) !== null) {
        matches.push(match[0]);
    }
    return matches;
}

const bytesToHexString = (bytes) => {
    return bytes.reduce((str, byte) => str + byte.toString(16).padStart(2, '0'), '');
};

const removeEmptyLeftBytes = (storageValue) => {
    const result = `${storageValue.replaceAll(/^0x0+/g, '')}`;
    if (!result.startsWith('0x')) {
        return `0x${result}`;
    }
    return result;
};

const decodeRlp = (rlpEncoded) => {
    const uint8ArrayDecoded = RLP.decode(rlpEncoded);
    const bytesStr = bytesToHexString(uint8ArrayDecoded);
    return bytesStr;
};

const getBridgeStorageValueDecodedHexString = (
    bridgeStorageValueEncodedAsRlp,
    append0xPrefix = true
) => {
    const rlpBytesWithoutEmptyBytes = removeEmptyLeftBytes(bridgeStorageValueEncodedAsRlp);
    const decodedHexFromRlp = decodeRlp(rlpBytesWithoutEmptyBytes);
    return append0xPrefix ? `0x${decodedHexFromRlp}` : decodedHexFromRlp;
};

const getBridgeStorageIndexFromKey = (storageKey) => {
    return Buffer.from(storageKey).toString('hex').padStart(64, '0').padStart(66, '0x');
};

const getBridgeStorageIndexFromLongKey = (storageKey) => {
    return Web3.utils.keccak256(Buffer.from(storageKey));
};

module.exports = {
    wait,
    ensure0x,
    removePrefix0x,
    removeDir,
    retryWithCheck,
    additionalFederationAddresses: {
        get: getAdditionalFederationAddresses,
        add: addAdditionalFederationAddress,
        remove: removeAdditionalFederationAddress,
    },
    splitStringIntoChunks,
    bytesToHexString,
    removeEmptyLeftBytes,
    decodeRlp,
    getBridgeStorageValueDecodedHexString,
    getBridgeStorageIndexFromKey,
    getBridgeStorageIndexFromLongKey,
};
