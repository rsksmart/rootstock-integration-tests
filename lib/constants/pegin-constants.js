const PEGIN_V1_RSKT_PREFIX_HEX = '52534b54';
const DEFAULT_RSK_ADDRESS_FUNDING_IN_BTC = 0.5;
// The pegin txs pay the federation(s) in their first outputs, before the sender change and any OP_RETURN output
const PEGIN_OUTPUT_INDEX_TO_FEDERATION = 0;

module.exports = {
    PEGIN_V1_RSKT_PREFIX_HEX,
    DEFAULT_RSK_ADDRESS_FUNDING_IN_BTC,
    PEGIN_OUTPUT_INDEX_TO_FEDERATION,
};
