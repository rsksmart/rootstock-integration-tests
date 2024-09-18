const expect = require('chai').expect;
const { getBridge } = require('../precompiled-abi-forks-util');
const { getBtcClient } = require('../btc-client-provider');
const { getRskTransactionHelpers, getRskTransactionHelper } = require('../rsk-tx-helper-provider');
const { btcToWeis, btcToSatoshis } = require('@rsksmart/btc-eth-unit-converter');
const { waitAndUpdateBridge, mineAndSync, findEventInBlock } = require('../rsk-utils');
const { PEGIN_EVENTS } = require("../constants");
const { waitForBitcoinTxToBeInMempool } = require('../btc-utils');
const {
    ensurePeginIsRegistered,
    donateToBridge,
    createSenderRecipientInfo,
    createExpectedPeginBtcEvent,
    mineForPeginRegistration,
} = require('../2wp-utils');
const { ensure0x } = require('../utils');
const bitcoinJsLib = require('bitcoinjs-lib');

const DONATION_AMOUNT = 250;
const MINIMUM_PEGIN_VALUE_IN_BTC = 0.5;

let btcTxHelper;
let rskTxHelper;
let rskTxHelpers;
let bridge;
let federationAddress;

const setupBridgeDonation = async (rskTxHelpers, btcTxHelper) => {
  const donatingBtcAddressInformation = await btcTxHelper.generateBtcAddress('legacy');
  await mineAndSync(rskTxHelpers);
  await btcTxHelper.fundAddress(donatingBtcAddressInformation.address, DONATION_AMOUNT + btcTxHelper.getFee());
  await donateToBridge(rskTxHelpers[0], btcTxHelper, donatingBtcAddressInformation, DONATION_AMOUNT);
};

const addInputs = (tx, sendersUtxosInfo) => {
  sendersUtxosInfo.flatMap(senderUtxosInfo => senderUtxosInfo.utxos).forEach(uxto => {
    tx.addInput(Buffer.from(uxto.txid, 'hex').reverse(), uxto.vout);
  });
};

const addChangeOutputs = (tx, sendersInfo, sendersChange) => {
  sendersChange.forEach((change, index) => {
    if(change > 0) {
      tx.addOutput(
        bitcoinJsLib.address.toOutputScript(sendersInfo[index].btcSenderAddressInfo.address, btcTxHelper.btcConfig.network),
        Number(btcToSatoshis(change))
      );
    }
  });
};

const addOutputsToFed = (tx, outputsToFed) => {
  outputsToFed.forEach(outputAmount => {
    tx.addOutput(
      bitcoinJsLib.address.toOutputScript(federationAddress, btcTxHelper.btcConfig.network),
      Number(btcToSatoshis(outputAmount))
    );
  });
};

const pushPegin = async (btcPeginTxHash, expectedUtxosCount) => {
  await waitForBitcoinTxToBeInMempool(btcTxHelper, btcPeginTxHash);
  await mineForPeginRegistration(rskTxHelper, btcTxHelper);
  await ensurePeginIsRegistered(rskTxHelper, btcPeginTxHash, expectedUtxosCount);
};

const getSendersInfo = async (initialBtcSenderBalancesInBtc) => {
  return await Promise.all(initialBtcSenderBalancesInBtc.map(initialBtcSenderBalance => createSenderRecipientInfo(rskTxHelper, btcTxHelper, 'legacy', initialBtcSenderBalance + btcTxHelper.getFee())));
};

const getSendersBtcAddressBalances = async (sendersInfo) => {
  return await Promise.all(sendersInfo.map(senderInfo => btcTxHelper.getAddressBalance(senderInfo.btcSenderAddressInfo.address)));
};

const getSendersUtxosInfo = async (sendersInfo, btcSenderAmountsToSendToFed) => {
  return await Promise.all(sendersInfo.map((senderInfo, index) => btcTxHelper.selectSpendableUTXOsFromAddress(senderInfo.btcSenderAddressInfo.address, btcSenderAmountsToSendToFed[index])));
};

const getSendersChange = (sendersUtxosInfo) => {
  return sendersUtxosInfo.map(senderUtxosInfo => senderUtxosInfo.change - btcTxHelper.getFee());
};

const getSendersPrivateKeys = (sendersInfo) => {
  return sendersInfo.map(senderInfo => senderInfo.btcSenderAddressInfo.privateKey);
};

const getTotalAmountToFed = (outputsToFed) => {
  return outputsToFed.reduce((total, amount) => total + amount, 0);
};

const getFinalRskRecipientBalances = async (sendersInfo) => {
  return await Promise.all(sendersInfo.map(senderInfo => rskTxHelper.getBalance(senderInfo.rskRecipientRskAddressInfo.address)));
};

const testsExpectedToPass = [
  {
    description: 'should do pegin with one input and one output to the federation',
    initialBtcSenderBalancesInBtc: [ MINIMUM_PEGIN_VALUE_IN_BTC ],
    btcSenderAmountsToSendToFed: [ MINIMUM_PEGIN_VALUE_IN_BTC ],
    outputsToFed: [ MINIMUM_PEGIN_VALUE_IN_BTC ],
  },
  {
    description: 'should do pegin with multiple inputs from different accounts and one output to the federation',
    initialBtcSenderBalancesInBtc: [ MINIMUM_PEGIN_VALUE_IN_BTC, MINIMUM_PEGIN_VALUE_IN_BTC, MINIMUM_PEGIN_VALUE_IN_BTC ], // Each sender is funded with some amount
    btcSenderAmountsToSendToFed: [ MINIMUM_PEGIN_VALUE_IN_BTC, MINIMUM_PEGIN_VALUE_IN_BTC, MINIMUM_PEGIN_VALUE_IN_BTC ], // Each sender decides how much to send to the federation
    outputsToFed: [ MINIMUM_PEGIN_VALUE_IN_BTC * 3 ],
  },
  {
    description: 'should do pegin with multiple inputs from different accounts and two outputs to the federation',
    initialBtcSenderBalancesInBtc: [ MINIMUM_PEGIN_VALUE_IN_BTC, MINIMUM_PEGIN_VALUE_IN_BTC, MINIMUM_PEGIN_VALUE_IN_BTC ],
    btcSenderAmountsToSendToFed: [ MINIMUM_PEGIN_VALUE_IN_BTC, MINIMUM_PEGIN_VALUE_IN_BTC, MINIMUM_PEGIN_VALUE_IN_BTC ],
    outputsToFed: [ MINIMUM_PEGIN_VALUE_IN_BTC, MINIMUM_PEGIN_VALUE_IN_BTC * 2 ], // Example of a pegin with multiple outputs to fed
  },
];

const execute = (description, getRskHost) => {

  describe(description, () => {

    before(async () => {

      rskTxHelpers = getRskTransactionHelpers();
      btcTxHelper = getBtcClient();
      rskTxHelper = getRskTransactionHelper(getRskHost());
      bridge = getBridge(rskTxHelper.getClient());

      federationAddress = await bridge.methods.getFederationAddress().call();
      await btcTxHelper.importAddress(federationAddress, 'federation');

      await waitAndUpdateBridge(rskTxHelper);
      await setupBridgeDonation(rskTxHelpers, btcTxHelper);

    });

    testsExpectedToPass.forEach(test => {

      it(test.description, async () => {

        // Arrange

        const { initialBtcSenderBalancesInBtc, btcSenderAmountsToSendToFed, outputsToFed } = test;

        const initialFederationAddressBalanceInBtc = Number(await btcTxHelper.getAddressBalance(federationAddress));

        const sendersInfo = await getSendersInfo(initialBtcSenderBalancesInBtc);
        const senderInfo1 = sendersInfo[0];

        const initialSendersBtcAddressBalances = await getSendersBtcAddressBalances(sendersInfo); 
        const sendersUtxosInfo = await getSendersUtxosInfo(sendersInfo, btcSenderAmountsToSendToFed);
        const sendersChange = getSendersChange(sendersUtxosInfo);

        const tx = new bitcoinJsLib.Transaction();
        addInputs(tx, sendersUtxosInfo);
        addOutputsToFed(tx, outputsToFed);
        addChangeOutputs(tx, sendersInfo, sendersChange);

        const sendersPrivateKeys = getSendersPrivateKeys(sendersInfo);
        const signedTx = await btcTxHelper.nodeClient.signTransaction(tx.toHex(), [], sendersPrivateKeys);

        // Act

        // Sending the pegin and ensuring the pegin is registered
        const btcPeginTxHash = await btcTxHelper.nodeClient.sendTransaction(signedTx);
        await pushPegin(btcPeginTxHash, outputsToFed.length);

        // Assert
  
        const isBtcTxHashAlreadyProcessed = await bridge.methods.isBtcTxHashAlreadyProcessed(btcPeginTxHash).call();
        expect(isBtcTxHashAlreadyProcessed).to.be.true;
  
        const totalAmountToFed = getTotalAmountToFed(outputsToFed);

        // The expected pegin_btc event should be emitted
        const recipient1RskAddressChecksumed = rskTxHelper.getClient().utils.toChecksumAddress(ensure0x(senderInfo1.rskRecipientRskAddressInfo.address));
        const expectedEvent = createExpectedPeginBtcEvent(PEGIN_EVENTS.PEGIN_BTC, recipient1RskAddressChecksumed, btcPeginTxHash, btcToSatoshis(totalAmountToFed));
        const btcTxHashProcessedHeight = Number(await bridge.methods.getBtcTxHashProcessedHeight(btcPeginTxHash).call());
        const peginBtcEvent = await findEventInBlock(rskTxHelper, expectedEvent.name, btcTxHashProcessedHeight);
        expect(peginBtcEvent).to.be.deep.equal(expectedEvent);
  
        // The federation address should have received the total amount sent by the senders
        const finalFederationAddressBalanceInBtc = Number(await btcTxHelper.getAddressBalance(federationAddress));
        expect(finalFederationAddressBalanceInBtc).to.be.equal(initialFederationAddressBalanceInBtc + totalAmountToFed);

        // The senders should have their balances reduced by the amount sent to the federation and the fee
        const finalSendersBtcAddressBalances = await getSendersBtcAddressBalances(sendersInfo);

        for(let i = 0; i < finalSendersBtcAddressBalances.length; i++) {
          const actualFinalBalance = Number(btcToSatoshis(finalSendersBtcAddressBalances[i]));
          const expectedFinalBalance = Number(btcToSatoshis(initialSendersBtcAddressBalances[i])) - Number(btcToSatoshis(btcSenderAmountsToSendToFed[i])) - Number(btcToSatoshis(btcTxHelper.getFee()));
          expect(actualFinalBalance).to.be.equal(expectedFinalBalance);
        }

        const finalRskRecipientBalances = await getFinalRskRecipientBalances(sendersInfo);

        // Retrieving and removing the first rsk recipient balance since only the first sender should have the amount locked.
        const firstRskRecipientBalance = finalRskRecipientBalances.shift();
        expect(Number(firstRskRecipientBalance)).to.be.equal(Number(btcToWeis(totalAmountToFed)));

        // The other rsk recipients should have their balances unchanged
        for(let i = 0; i < finalRskRecipientBalances.length; i++) {
          const actualFinalBalance = Number(finalRskRecipientBalances[i]);
          const expectedFinalBalance = 0;
          expect(actualFinalBalance).to.be.equal(expectedFinalBalance);
        }

      });

    });

  });

}

module.exports = {
  execute,
};
