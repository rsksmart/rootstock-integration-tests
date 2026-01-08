const decodeUnionLogs = (rskClient, txReceipt, unionAndBridgeAbis) => {
  const eventSignatureMap = buildEventSignatureMap(rskClient, unionAndBridgeAbis);
  const events = [];
  for (let log of txReceipt.logs) {
    if (log.topics.length === 0) {
      continue;
    }

    const eventSignature = log.topics[0];
    const abiElement = eventSignatureMap[eventSignature];
    if (!abiElement) {
      continue;
    }
    const event = decodeUnionLog(rskClient, log, abiElement);
    events.push(event);
  }
  return events;
};

const buildEventSignatureMap = (rskClient, abis) => {
  return abis
    .flat()
    .filter((element) => element.type === "event")
    .reduce((acc, element) => {
      const signature = rskClient.eth.abi.encodeEventSignature(element);
      acc[signature] = element;
      return acc;
    }, {});
};

const decodeUnionLog = (rskClient, log, abiElement) => {
  const decodedLog = rskClient.eth.abi.decodeLog(abiElement.inputs, log.data, log.topics.slice(1));

  const args = {};
  for (let input of abiElement.inputs) {
    args[input.name] = decodedLog[input.name];
  }

  return {
    name: abiElement.name,
    signature: log.topics[0],
    args: args,
  };
};

module.exports = {
  decodeUnionLogs,
};
