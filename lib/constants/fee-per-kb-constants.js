const FEE_PER_KB_CHANGER_PRIVATE_KEY =
    '6a4b49312b91e203ddfb9bc2d900ebbd46fbede46a7462e770bedcb11ad405e9';
const FEE_PER_KB_CHANGER_ADDRESS = '53f8f6dabd612b6137215ddd7758bb5cdd638922';

// Bridge-defined genesis fee per kb (RSKj genesisFeePerKb = Coin.MILLICOIN), in satoshis.
const GENESIS_FEE_PER_KB = 100000;

// Bridge-defined maximum fee per kb (RSKj FeePerKbRegTestConstants.maxFeePerKb), in satoshis.
const MAX_FEE_PER_KB = 5000000;

const FEE_PER_KB_RESPONSE_CODES = {
    SUCCESSFUL_VOTE: 1,
    EXCESSIVE_FEE_VOTED: -2,
    UNAUTHORIZED_CALLER: -10,
};

module.exports = {
    FEE_PER_KB_CHANGER_PRIVATE_KEY,
    FEE_PER_KB_CHANGER_ADDRESS,
    GENESIS_FEE_PER_KB,
    MAX_FEE_PER_KB,
    FEE_PER_KB_RESPONSE_CODES,
};
