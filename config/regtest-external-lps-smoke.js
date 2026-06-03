module.exports = {
    init: {
        mineInitialBitcoin: false,
    },
    runners: {
        bitcoin: {
            host: '127.0.0.1',
            port: 18444,
            rpcPort: 5555,
            rpcUser: 'test',
            rpcPassword: 'test',
        },
        federates: [
            {
                federationId: 'external-regtest',
                host: '127.0.0.1:4444',
                publicKeys: {
                    btc: '0x00',
                    rsk: '0x00',
                    mst: '0x00',
                },
            },
        ],
    },
    federations: {
        genesisFederation: {
            members: [],
        },
    },
};
