const PEGIN_EVENTS = {
    PEGIN_BTC: {
        name: 'pegin_btc',
        signature: '0x44cdc782a38244afd68336ab92a0b39f864d6c0b2a50fa1da58cafc93cd2ae5a',
    },
    REJECTED_PEGIN: {
        name: 'rejected_pegin',
        signature: '0x708ce1ead20561c5894a93be3fee64b326b2ad6c198f8253e4bb56f1626053d6',
    },
    UNREFUNDABLE_PEGIN: {
        name: 'unrefundable_pegin',
        signature: '0x35be155c87e408cbbcb753dc12f95fc5a242a29460a3d7189e807e63d7c185a7',
    },
};

const PEGOUT_EVENTS = {
    RELEASE_REQUEST_RECEIVED: {
        name: 'release_request_received',
        signature: '0x1a4457a4460d48b40c5280955faf8e4685fa73f0866f7d8f573bdd8e64aca5b1',
    },
    RELEASE_REQUEST_REJECTED: {
        name: 'release_request_rejected',
        signature: '0xb607c3e1fbe6b38cd145b15b837f7b722b199caa60e3057b36c141adee3b75e7',
    },
    RELEASE_REQUESTED: {
        name: 'release_requested',
        signature: '0x7a7c29481528ac8c2b2e93aee658fddd4dc15304fa723a5c2b88514557bcc790',
    },
    BATCH_PEGOUT_CREATED: {
        name: 'batch_pegout_created',
        signature: '0x483d0191cc4e784b04a41f6c4801a0766b43b1fdd0b9e3e6bfdca74e5b05c2eb',
    },
    PEGOUT_TRANSACTION_CREATED: {
        name: 'pegout_transaction_created',
        signature: '0x9ee5d520fd5e6eaea3fd2e3ae4e35e9a9c0fb05c9d8f84b507f287da84b5117c',
    },
    PEGOUT_CONFIRMED: {
        name: 'pegout_confirmed',
        signature: '0xc287f602476eeef8a547a3b82e79045c827c51362ff153f728b6d839bad099ef',
    },
    ADD_SIGNATURE: {
        name: 'add_signature',
        signature: '0x83b6efe3a7d95459577ec9396f5d6f1e486ca2378130e2ba4d98a4da108ca743',
    },
    RELEASE_BTC: {
        name: 'release_btc',
        signature: '0x655929b56d5c5a24f81ee80267d5151b9d680e7e703387999922e9070bc98a02',
    },
};

const PEGIN_REJECTION_REASONS = {
    PEGIN_CAP_SURPASSED_REASON: '1',
    LEGACY_PEGIN_MULTISIG_SENDER: '2',
    LEGACY_PEGIN_UNDETERMINED_SENDER: '3',
    PEGIN_V1_INVALID_PAYLOAD_REASON: '4',
    INVALID_AMOUNT: '5',
};

const PEGIN_UNREFUNDABLE_REASONS = {
    LEGACY_PEGIN_UNDETERMINED_SENDER: '1',
    INVALID_AMOUNT: '3',
};

const PEGOUT_REJECTION_REASONS = {
    LOW_AMOUNT: '1',
    CALLER_CONTRACT: '2',
    FEE_ABOVE_VALUE: '3',
};

module.exports = {
    PEGIN_EVENTS,
    PEGOUT_EVENTS,
    PEGIN_REJECTION_REASONS,
    PEGIN_UNREFUNDABLE_REASONS,
    PEGOUT_REJECTION_REASONS,
};
