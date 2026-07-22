const { KEY_TYPE_BTC, KEY_TYPE_RSK, KEY_TYPE_MST } = require('./constants/federation-constants');
const { ethToWeis } = require('@rsksmart/btc-eth-unit-converter');
const rskUtils = require('./rsk-utils');
const federateStarter = require('./federate-starter');
const { wait } = require('./utils');

const comparePublicKeys = (publicKeyA, publicKeyB) => {
    if (publicKeyA < publicKeyB) {
        return -1;
    }

    if (publicKeyA > publicKeyB) {
        return 1;
    }

    return 0;
};

const compareFederateKeys = (publicKeysA, publicKeysB) => {
    let comparison = comparePublicKeys(publicKeysA[KEY_TYPE_BTC], publicKeysB[KEY_TYPE_BTC]);
    if (comparison === 0) {
        comparison = comparePublicKeys(publicKeysA[KEY_TYPE_RSK], publicKeysB[KEY_TYPE_RSK]);
        if (comparison === 0) {
            comparison = comparePublicKeys(publicKeysA[KEY_TYPE_MST], publicKeysB[KEY_TYPE_MST]);
        }
    }
    return comparison;
};

const getNewFederationPublicKeysFromNewFederationConfig = (newFederationConfig) => {
    const newFederationPublicKeys = newFederationConfig.members.map((member) => member.publicKeys);
    newFederationPublicKeys.sort((keyA, keyB) => keyA.btc.localeCompare(keyB.btc));
    return newFederationPublicKeys;
};

const stopPreviousFederators = async (newFederationConfig) => {
    let previousFederationId;

    switch (newFederationConfig.federationId) {
        case 'second-federation':
            previousFederationId = 'genesis-federation';
            break;
        case 'third-federation':
            previousFederationId = 'second-federation';
            break;
        case 'fourth-federation':
            previousFederationId = 'third-federation';
            break;
    }

    for (const fedRunner of Runners.fedRunners) {
        if (fedRunner.options.federationId === previousFederationId) {
            console.log(`Stopping federator with id: "${fedRunner.options.id}"`);
            fedRunner.stop();
            if (fedRunner.hsm) {
                fedRunner.hsm.stop();
                fedRunner.hsm = null;
            }
        }
    }

    await wait(2000);

    Runners.fedRunners = Runners.fedRunners.filter(
        (fedRunner) => fedRunner.options.federationId !== previousFederationId
    );
    Runners.hosts.federates = Runners.hosts.federates.filter(
        (fedHostInfo) => fedHostInfo.federationId !== previousFederationId
    );
    Runners.hosts.federate = Runners.hosts.federates[0];
};

const startNewFederationNodes = async (newFederationConfig, rskTxHelper) => {
    const hasHsm = newFederationConfig.some((member) => member.type === 'hsm');
    let blockHashCheckpoint;
    if (hasHsm) {
        const latestBlockNumber = await rskTxHelper.getBlockNumber();
        blockHashCheckpoint = (await rskTxHelper.getBlock(latestBlockNumber - 10)).hash;
    }
    for (let i = 0; i < newFederationConfig.length; i++) {
        const fedConfig = newFederationConfig[i];
        await federateStarter.startFederate(i + 1, fedConfig, blockHashCheckpoint);
    }
};

const fundNewFederators = async (rskTxHelper, newFederationConfig) => {
    for (const newFederatorConfig of newFederationConfig) {
        const newFederatorRskCompressedPublicKey = newFederatorConfig.publicKeys.rsk;
        const newFederatorRskAddress = rskUtils.getAddressFromUncompressedPublicKey(
            rskUtils.uncompressPublicKey(newFederatorRskCompressedPublicKey)
        );
        await rskUtils.sendFromCow(rskTxHelper, newFederatorRskAddress, ethToWeis(0.1));
    }
};

const getActiveFederationPublicKeys = async (bridge) => {
    const initialFederationKeys = [];

    const initialFederationSize = Number(await bridge.getFederationSize());

    for (let i = 0; i < initialFederationSize; i++) {
        const federatorBtcPublicKey = await bridge.getFederatorPublicKeyOfType(i, KEY_TYPE_BTC);
        const federatorRskPublicKey = await bridge.getFederatorPublicKeyOfType(i, KEY_TYPE_RSK);
        const federatorMstPublicKey = await bridge.getFederatorPublicKeyOfType(i, KEY_TYPE_MST);

        initialFederationKeys.push({
            [KEY_TYPE_BTC]: federatorBtcPublicKey,
            [KEY_TYPE_RSK]: federatorRskPublicKey,
            [KEY_TYPE_MST]: federatorMstPublicKey,
        });
    }

    return initialFederationKeys;
};

const getProposedFederationPublicKeys = async (bridge) => {
    const proposedFederationKeys = [];

    const proposedFederationSize = Number(await bridge.getProposedFederationSize());

    for (let i = 0; i < proposedFederationSize; i++) {
        const federatorBtcPublicKey = await bridge.getProposedFederatorPublicKeyOfType(
            i,
            KEY_TYPE_BTC
        );
        const federatorRskPublicKey = await bridge.getProposedFederatorPublicKeyOfType(
            i,
            KEY_TYPE_RSK
        );
        const federatorMstPublicKey = await bridge.getProposedFederatorPublicKeyOfType(
            i,
            KEY_TYPE_MST
        );

        proposedFederationKeys.push({
            [KEY_TYPE_BTC]: federatorBtcPublicKey,
            [KEY_TYPE_RSK]: federatorRskPublicKey,
            [KEY_TYPE_MST]: federatorMstPublicKey,
        });
    }

    return proposedFederationKeys;
};

const getRetiringFederationPublicKeys = async (bridge) => {
    const retiringFederationKeys = [];

    const retiringFederationSize = Number(await bridge.getRetiringFederationSize());

    for (let i = 0; i < retiringFederationSize; i++) {
        const federatorBtcPublicKey = await bridge.getRetiringFederatorPublicKeyOfType(
            i,
            KEY_TYPE_BTC
        );
        const federatorRskPublicKey = await bridge.getRetiringFederatorPublicKeyOfType(
            i,
            KEY_TYPE_RSK
        );
        const federatorMstPublicKey = await bridge.getRetiringFederatorPublicKeyOfType(
            i,
            KEY_TYPE_MST
        );

        retiringFederationKeys.push({
            [KEY_TYPE_BTC]: federatorBtcPublicKey,
            [KEY_TYPE_RSK]: federatorRskPublicKey,
            [KEY_TYPE_MST]: federatorMstPublicKey,
        });
    }

    return retiringFederationKeys;
};

const getActiveFederationInfo = async (bridge) => {
    const activeFederationInfoResponses = await Promise.all([
        bridge.getFederationSize(),
        bridge.getFederationAddress(),
        bridge.getFederationCreationBlockNumber(),
        bridge.getFederationCreationTime(),
    ]);

    const size = Number(activeFederationInfoResponses[0]);
    const address = activeFederationInfoResponses[1];
    const creationBlockNumber = Number(activeFederationInfoResponses[2]);
    const creationTime = Number(activeFederationInfoResponses[3]);

    return {
        size,
        address,
        creationBlockNumber,
        creationTime,
    };
};

const getProposedFederationInfo = async (bridge) => {
    const proposedFederationInfoResponses = await Promise.all([
        bridge.getProposedFederationSize(),
        bridge.getProposedFederationAddress(),
        bridge.getProposedFederationCreationBlockNumber(),
        bridge.getProposedFederationCreationTime(),
    ]);

    const size = Number(proposedFederationInfoResponses[0]);
    const address = proposedFederationInfoResponses[1];
    const creationBlockNumber = Number(proposedFederationInfoResponses[2]);
    const creationTime = Number(proposedFederationInfoResponses[3]);

    return {
        size,
        address,
        creationBlockNumber,
        creationTime,
    };
};

const getRetiringFederationInfo = async (bridge) => {
    const retiringFederationInfoResponses = await Promise.all([
        bridge.getRetiringFederationSize(),
        bridge.getRetiringFederationAddress(),
        bridge.getRetiringFederationCreationBlockNumber(),
        bridge.getRetiringFederationCreationTime(),
    ]);

    const size = Number(retiringFederationInfoResponses[0]);
    const address = retiringFederationInfoResponses[1];
    const creationBlockNumber = Number(retiringFederationInfoResponses[2]);
    const creationTime = Number(retiringFederationInfoResponses[3]);

    return {
        size,
        address,
        creationBlockNumber,
        creationTime,
    };
};

module.exports = {
    comparePublicKeys,
    compareFederateKeys,
    getNewFederationPublicKeysFromNewFederationConfig,
    stopPreviousFederators,
    startNewFederationNodes,
    fundNewFederators,
    getProposedFederationPublicKeys,
    getProposedFederationInfo,
    getActiveFederationPublicKeys,
    getRetiringFederationPublicKeys,
    getActiveFederationInfo,
    getRetiringFederationInfo,
};
