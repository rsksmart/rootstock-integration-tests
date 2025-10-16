const path = require('path');
const nodesConfigPath = 'config/node-configs';
const keysPathResolve = 'node-keys';
const powpegNodeJarPath = process.env.POWPEG_NODE_JAR_PATH;
const federatesLogbackPath = process.env.LOG_HOME || path.resolve(__dirname, '../logs');

const bookkeepingConfigurations = {
    difficultyTarget: "3",
    informerInterval: "8000",
    maxAmountBlockHeaders: "50",
    maxChunkSizeToHsm: "100"
};

const DIFFICULTY_TARGET_IN_HEX = '0x03';

module.exports = {
    init: {
        mineInitialBitcoin: true,
        federatesLogbackFile: federatesLogbackPath
    },
    btc: {
        rpcUser: 'test',
        rpcPassword: 'test',
        dir: process.env.BITCOIN_DATA_DIR || path.resolve(__dirname, '../bitcoin-data'),
    },
    federations: {
        genesisFederation: {
            federationId: 'genesis-federation',
            members: [
                {
                    id: 'federator-1-genesis-federation',
                    federationId: 'genesis-federation',
                    logbackFile: `${federatesLogbackPath}/genesis-federation/fed1.xml`,
                    classpath: powpegNodeJarPath,
                    configFile: `${nodesConfigPath}/genesis-federation/fed1.conf`,
                    publicKeys: {
                        btc: '0x0362634ab57dae9cb373a5d536e66a8c4f67468bbcfb063809bab643072d78a124',
                        rsk: '0x0362634ab57dae9cb373a5d536e66a8c4f67468bbcfb063809bab643072d78a124',
                        mst: '0x0362634ab57dae9cb373a5d536e66a8c4f67468bbcfb063809bab643072d78a124',
                    },
                    customConfig: {
                        'federator.signers.BTC.type': 'keyFile',
                        'federator.signers.BTC.path': path.resolve(__dirname, `${keysPathResolve}/genesis-federation/fed1.key`),
                        'federator.signers.RSK.type': 'keyFile',
                        'federator.signers.RSK.path': path.resolve(__dirname, `${keysPathResolve}/genesis-federation/fed1.key`),
                        'federator.signers.MST.type': 'keyFile',
                        'federator.signers.MST.path': path.resolve(__dirname, `${keysPathResolve}/genesis-federation/fed1.key`),
                        
                        'peer.active.0.ip': '127.0.0.1',
                        'peer.active.0.port': 30002,
                        'peer.active.0.nodeId': 'c5946b3fbae03a654237da863c9ed534e0878657175b132b8ca630f245df04dbb0bde4f3854613b16032fb214f9cc00f75363976ee078cc4409cdc543036ccfd',

                        'peer.active.1.ip': '127.0.0.1',
                        'peer.active.1.port': 30004,
                        'peer.active.1.nodeId': 'cd53fc53a07f211641a677d250f6de99caf620e8e77071e811a28b3bcddf0be19e9da12b897b83765fbaebe717fab74fcb1b57c82f7978b8be3296239909e626',

                        'peer.active.2.ip': '127.0.0.1',
                        'peer.active.2.port': 40000,
                        'peer.active.2.nodeId': '328105ab6744914e61bcfcb729d741f23528fd6eb1b42628120ab027d82c9c2d8c445f8c6727e291e1abcaa8398bf47d4cca6ea6600b137b875b8df22251e325',
                    
                        'federator.amountOfHeadersToSend': 500,
                    },
                    bookkeepingConfigurations,
                    port: 30000,
                    rpcPort: 30001,
                    nodeId: '62634ab57dae9cb373a5d536e66a8c4f67468bbcfb063809bab643072d78a1243bd206c2c7a218d6ff4c9a185e71f066bd354e5267875b7683fbc70a1d455e87'
                },
                {
                    id: 'federator-2-genesis-federation',
                    federationId: 'genesis-federation',
                    logbackFile: `${federatesLogbackPath}/genesis-federation/fed2.xml`,
                    classpath: powpegNodeJarPath,
                    configFile: `${nodesConfigPath}/genesis-federation/fed2.conf`,
                    publicKeys: {
                        btc: '0x03c5946b3fbae03a654237da863c9ed534e0878657175b132b8ca630f245df04db',
                        rsk: '0x03c5946b3fbae03a654237da863c9ed534e0878657175b132b8ca630f245df04db',
                        mst: '0x03c5946b3fbae03a654237da863c9ed534e0878657175b132b8ca630f245df04db',
                    },
                    customConfig: {
                        'federator.signers.BTC.type': 'keyFile',
                        'federator.signers.BTC.path': path.resolve(__dirname, `${keysPathResolve}/genesis-federation/fed2.key`),
                        'federator.signers.RSK.type': 'keyFile',
                        'federator.signers.RSK.path': path.resolve(__dirname, `${keysPathResolve}/genesis-federation/fed2.key`),
                        'federator.signers.MST.type': 'keyFile',
                        'federator.signers.MST.path': path.resolve(__dirname, `${keysPathResolve}/genesis-federation/fed2.key`),
                        
                        'peer.active.0.ip': '127.0.0.1',
                        'peer.active.0.port': 30000,
                        'peer.active.0.nodeId': '62634ab57dae9cb373a5d536e66a8c4f67468bbcfb063809bab643072d78a1243bd206c2c7a218d6ff4c9a185e71f066bd354e5267875b7683fbc70a1d455e87',

                        'peer.active.1.ip': '127.0.0.1',
                        'peer.active.1.port': 30004,
                        'peer.active.1.nodeId': 'cd53fc53a07f211641a677d250f6de99caf620e8e77071e811a28b3bcddf0be19e9da12b897b83765fbaebe717fab74fcb1b57c82f7978b8be3296239909e626',

                        'federator.amountOfHeadersToSend': 500,
                        
                    },
                    bookkeepingConfigurations,
                    port: 30002,
                    rpcPort: 30003,
                    nodeId: 'c5946b3fbae03a654237da863c9ed534e0878657175b132b8ca630f245df04dbb0bde4f3854613b16032fb214f9cc00f75363976ee078cc4409cdc543036ccfd'
                },
                {
                    id: 'federator-3-genesis-federation',
                    federationId: 'genesis-federation',
                    logbackFile: `${federatesLogbackPath}/genesis-federation/fed3.xml`,
                    classpath: powpegNodeJarPath,
                    configFile: `${nodesConfigPath}/genesis-federation/fed3.conf`,
                    publicKeys: {
                        btc: '0x02cd53fc53a07f211641a677d250f6de99caf620e8e77071e811a28b3bcddf0be1',
                        rsk: '0x02cd53fc53a07f211641a677d250f6de99caf620e8e77071e811a28b3bcddf0be1',
                        mst: '0x02cd53fc53a07f211641a677d250f6de99caf620e8e77071e811a28b3bcddf0be1',
                    },
                    customConfig: {
                        'federator.signers.BTC.type': 'keyFile',
                        'federator.signers.BTC.path': path.resolve(__dirname, `${keysPathResolve}/genesis-federation/fed3.key`),
                        'federator.signers.RSK.type': 'keyFile',
                        'federator.signers.RSK.path': path.resolve(__dirname, `${keysPathResolve}/genesis-federation/fed3.key`),
                        'federator.signers.MST.type': 'keyFile',
                        'federator.signers.MST.path': path.resolve(__dirname, `${keysPathResolve}/genesis-federation/fed3.key`),
                        
                        'peer.active.0.ip': '127.0.0.1',
                        'peer.active.0.port': 30000,
                        'peer.active.0.nodeId': '62634ab57dae9cb373a5d536e66a8c4f67468bbcfb063809bab643072d78a1243bd206c2c7a218d6ff4c9a185e71f066bd354e5267875b7683fbc70a1d455e87',

                        'peer.active.1.ip': '127.0.0.1',
                        'peer.active.1.port': 30002,
                        'peer.active.1.nodeId': 'c5946b3fbae03a654237da863c9ed534e0878657175b132b8ca630f245df04dbb0bde4f3854613b16032fb214f9cc00f75363976ee078cc4409cdc543036ccfd',

                        'federator.amountOfHeadersToSend': 500,
                    },
                    bookkeepingConfigurations,
                    port: 30004,
                    rpcPort: 30005,
                    nodeId: 'cd53fc53a07f211641a677d250f6de99caf620e8e77071e811a28b3bcddf0be19e9da12b897b83765fbaebe717fab74fcb1b57c82f7978b8be3296239909e626'
                }
            ]
        },
        secondFederation: {
            federationId: 'second-federation',
            members: [
                {
                    id: 'federator-1-second-federation',
                    federationId: 'second-federation',
                    type: 'keyfile',
                    logbackFile: `${federatesLogbackPath}/second-federation/fed1.xml`,
                    classpath: powpegNodeJarPath,
                    configFile: `${nodesConfigPath}/second-federation/fed1.conf`,
                    publicKeys: {
                        btc: '0x03328105ab6744914e61bcfcb729d741f23528fd6eb1b42628120ab027d82c9c2d',
                        rsk: '0x03328105ab6744914e61bcfcb729d741f23528fd6eb1b42628120ab027d82c9c2d',
                        mst: '0x03328105ab6744914e61bcfcb729d741f23528fd6eb1b42628120ab027d82c9c2d',
                    },
                    customConfig: {
                        'federator.signers.BTC.type': 'keyFile',
                        'federator.signers.BTC.path': path.resolve(__dirname, `${keysPathResolve}/second-federation/fed1.key`),
                        'federator.signers.RSK.type': 'keyFile',
                        'federator.signers.RSK.path': path.resolve(__dirname, `${keysPathResolve}/second-federation/fed1.key`),
                        'federator.signers.MST.type': 'keyFile',
                        'federator.signers.MST.path': path.resolve(__dirname, `${keysPathResolve}/second-federation/fed1.key`),
                    
                        'peer.active.0.ip': '127.0.0.1',
                        'peer.active.0.port': 30000,
                        'peer.active.0.nodeId': '62634ab57dae9cb373a5d536e66a8c4f67468bbcfb063809bab643072d78a1243bd206c2c7a218d6ff4c9a185e71f066bd354e5267875b7683fbc70a1d455e87',

                        'peer.active.1.ip': '127.0.0.1',
                        'peer.active.1.port': 40002,
                        'peer.active.1.nodeId': '8ac219dc7ac6bfe401892ddd26c63f14e7cd5b62c750162c0889eee19c1725c29e52c00bc91ee260241d2e4ddcf72ed69746b226fc7c1c63f906d19a7a31988a',

                        'peer.active.2.ip': '127.0.0.1',
                        'peer.active.2.port': 40004,
                        'peer.active.2.nodeId': '5ba2b832b97cfba1626eb264bd1ec2733a7ca02602153c57c0c95c9700030dccb0edb612fd01bd806c0202aa3380fb8dcbeddb7a1386259d4b9679c0003d04bc',

                        'peer.active.3.ip': '127.0.0.1',
                        'peer.active.3.port': 50000,
                        'peer.active.3.nodeId': '4ba6ec42eab139697c3614653e130e76fc15d1d7e5c91b3df63d3c06195d42265a5550cda65aa54de279a79a55e5513598b183e64f351e790d6370a6c67b141d',

                        'federator.amountOfHeadersToSend': 500,
                    },
                    bookkeepingConfigurations,
                    port: 40000,
                    rpcPort: 40001,
                    nodeId: '328105ab6744914e61bcfcb729d741f23528fd6eb1b42628120ab027d82c9c2d8c445f8c6727e291e1abcaa8398bf47d4cca6ea6600b137b875b8df22251e325'
                },
                {
                    id: 'federator-2-second-federation',
                    federationId: 'second-federation',
                    type: 'hsm',
                    hsmPort: 9981,
                    hsmDifficultyTarget: DIFFICULTY_TARGET_IN_HEX,
                    logbackFile: `${federatesLogbackPath}/second-federation/fed2.xml`,
                    classpath: powpegNodeJarPath,
                    configFile: `${nodesConfigPath}/second-federation/fed2.conf`,
                    publicKeys: {
                        btc: '0x028ac219dc7ac6bfe401892ddd26c63f14e7cd5b62c750162c0889eee19c1725c2',
                        rsk: '0x028ac219dc7ac6bfe401892ddd26c63f14e7cd5b62c750162c0889eee19c1725c2',
                        mst: '0x028ac219dc7ac6bfe401892ddd26c63f14e7cd5b62c750162c0889eee19c1725c2',
                    },
                    customConfig: {

                        'peer.active.0.ip': '127.0.0.1',
                        'peer.active.0.port': 30000,
                        'peer.active.0.nodeId': '62634ab57dae9cb373a5d536e66a8c4f67468bbcfb063809bab643072d78a1243bd206c2c7a218d6ff4c9a185e71f066bd354e5267875b7683fbc70a1d455e87',

                        'peer.active.1.ip': '127.0.0.1',
                        'peer.active.1.port': 40000,
                        'peer.active.1.nodeId': '328105ab6744914e61bcfcb729d741f23528fd6eb1b42628120ab027d82c9c2d8c445f8c6727e291e1abcaa8398bf47d4cca6ea6600b137b875b8df22251e325',

                        'peer.active.2.ip': '127.0.0.1',
                        'peer.active.2.port': 40004,
                        'peer.active.2.nodeId': '5ba2b832b97cfba1626eb264bd1ec2733a7ca02602153c57c0c95c9700030dccb0edb612fd01bd806c0202aa3380fb8dcbeddb7a1386259d4b9679c0003d04bc',

                        'federator.amountOfHeadersToSend': 500,
                    },
                    bookkeepingConfigurations,
                    port: 40002,
                    rpcPort: 40003,
                    nodeId: '8ac219dc7ac6bfe401892ddd26c63f14e7cd5b62c750162c0889eee19c1725c29e52c00bc91ee260241d2e4ddcf72ed69746b226fc7c1c63f906d19a7a31988a'
                },
                {
                    id: 'federator-3-second-federation',
                    federationId: 'second-federation',
                    type: 'hsm',
                    hsmPort: 9983,
                    hsmDifficultyTarget: DIFFICULTY_TARGET_IN_HEX,
                    logbackFile: `${federatesLogbackPath}/second-federation/fed3.xml`,
                    classpath: powpegNodeJarPath,
                    configFile: `${nodesConfigPath}/second-federation/fed3.conf`,
                    publicKeys: {
                        btc: '0x025ba2b832b97cfba1626eb264bd1ec2733a7ca02602153c57c0c95c9700030dcc',
                        rsk: '0x025ba2b832b97cfba1626eb264bd1ec2733a7ca02602153c57c0c95c9700030dcc',
                        mst: '0x025ba2b832b97cfba1626eb264bd1ec2733a7ca02602153c57c0c95c9700030dcc',
                    },
                    customConfig: {
                        
                        'peer.active.0.ip': '127.0.0.1',
                        'peer.active.0.port': 30000,
                        'peer.active.0.nodeId': '62634ab57dae9cb373a5d536e66a8c4f67468bbcfb063809bab643072d78a1243bd206c2c7a218d6ff4c9a185e71f066bd354e5267875b7683fbc70a1d455e87',

                        'peer.active.1.ip': '127.0.0.1',
                        'peer.active.1.port': 40000,
                        'peer.active.1.nodeId': '328105ab6744914e61bcfcb729d741f23528fd6eb1b42628120ab027d82c9c2d8c445f8c6727e291e1abcaa8398bf47d4cca6ea6600b137b875b8df22251e325',

                        'peer.active.2.ip': '127.0.0.1',
                        'peer.active.2.port': 40002,
                        'peer.active.2.nodeId': '8ac219dc7ac6bfe401892ddd26c63f14e7cd5b62c750162c0889eee19c1725c29e52c00bc91ee260241d2e4ddcf72ed69746b226fc7c1c63f906d19a7a31988a',

                        'federator.amountOfHeadersToSend': 500,
                    },
                    bookkeepingConfigurations,
                    port: 40004,
                    rpcPort: 40005,
                    nodeId: '5ba2b832b97cfba1626eb264bd1ec2733a7ca02602153c57c0c95c9700030dccb0edb612fd01bd806c0202aa3380fb8dcbeddb7a1386259d4b9679c0003d04bc'
                }
            ]
        },
        thirdFederation: {
            federationId: 'third-federation',
            members: [
                {
                    id: 'federator-1-third-federation',
                    federationId: 'third-federation',
                    type: 'keyfile',
                    logbackFile: `${federatesLogbackPath}/third-federation/fed1.xml`,
                    classpath: powpegNodeJarPath,
                    configFile: `${nodesConfigPath}/third-federation/fed1.conf`,
                    publicKeys: {
                        btc: '0x034ba6ec42eab139697c3614653e130e76fc15d1d7e5c91b3df63d3c06195d4226',
                        rsk: '0x034ba6ec42eab139697c3614653e130e76fc15d1d7e5c91b3df63d3c06195d4226',
                        mst: '0x034ba6ec42eab139697c3614653e130e76fc15d1d7e5c91b3df63d3c06195d4226',
                    },
                    customConfig: {
                        'federator.signers.BTC.type': 'keyFile',
                        'federator.signers.BTC.path': path.resolve(__dirname, `${keysPathResolve}/third-federation/fed1.key`),
                        'federator.signers.RSK.type': 'keyFile',
                        'federator.signers.RSK.path': path.resolve(__dirname, `${keysPathResolve}/third-federation/fed1.key`),
                        'federator.signers.MST.type': 'keyFile',
                        'federator.signers.MST.path': path.resolve(__dirname, `${keysPathResolve}/third-federation/fed1.key`),
                        
                        'peer.active.0.ip': '127.0.0.1',
                        'peer.active.0.port': 40000,
                        'peer.active.0.nodeId': '328105ab6744914e61bcfcb729d741f23528fd6eb1b42628120ab027d82c9c2d8c445f8c6727e291e1abcaa8398bf47d4cca6ea6600b137b875b8df22251e325',

                        'peer.active.1.ip': '127.0.0.1',
                        'peer.active.1.port': 50002,
                        'peer.active.1.nodeId': '0b1d25b03d041028326ac5b27af941524c31bf09df5fece7476d3940f9cd2394d3cd349b9b265b7427607736dcee323d9e4a893b1d15549c928278a4e6012c08',

                        'peer.active.2.ip': '127.0.0.1',
                        'peer.active.2.port': 50004,
                        'peer.active.2.nodeId': '328105ab6744914e61bcfcb729d741f23528fd6eb1b42628120ab027d82c9c2d8c445f8c6727e291e1abcaa8398bf47d4cca6ea6600b137b875b8df22251e325',

                        'peer.active.3.ip': '127.0.0.1',
                        'peer.active.3.port': 50006,
                        'peer.active.3.nodeId': '8ac219dc7ac6bfe401892ddd26c63f14e7cd5b62c750162c0889eee19c1725c29e52c00bc91ee260241d2e4ddcf72ed69746b226fc7c1c63f906d19a7a31988a',

                        'peer.active.4.ip': '127.0.0.1',
                        'peer.active.4.port': 60000,
                        'peer.active.4.nodeId': '3ebf25b39fa357d14afd8cf2a66207e7c2eba9e0e21d96d3026f62e2451724d28e2800a5c024e62e6edad2073fc1670df7e7e7c157436c53e73bb72f1d58f88d',

                        'federator.amountOfHeadersToSend': 500,
                    },
                    bookkeepingConfigurations,
                    port: 50000,
                    rpcPort: 50001,
                    nodeId: '4ba6ec42eab139697c3614653e130e76fc15d1d7e5c91b3df63d3c06195d42265a5550cda65aa54de279a79a55e5513598b183e64f351e790d6370a6c67b141d'
                },
                {
                    id: 'federator-2-third-federation',
                    federationId: 'third-federation',
                    type: 'hsm',
                    hsmPort: 9987,
                    hsmDifficultyTarget: DIFFICULTY_TARGET_IN_HEX,
                    logbackFile: `${federatesLogbackPath}/third-federation/fed2.xml`,
                    classpath: powpegNodeJarPath,
                    configFile: `${nodesConfigPath}/third-federation/fed2.conf`,
                    publicKeys: {
                        btc: '0x020b1d25b03d041028326ac5b27af941524c31bf09df5fece7476d3940f9cd2394',
                        rsk: '0x020b1d25b03d041028326ac5b27af941524c31bf09df5fece7476d3940f9cd2394',
                        mst: '0x020b1d25b03d041028326ac5b27af941524c31bf09df5fece7476d3940f9cd2394',
                    },
                    customConfig: {

                        'peer.active.0.ip': '127.0.0.1',
                        'peer.active.0.port': 50000,
                        'peer.active.0.nodeId': '4ba6ec42eab139697c3614653e130e76fc15d1d7e5c91b3df63d3c06195d42265a5550cda65aa54de279a79a55e5513598b183e64f351e790d6370a6c67b141d',

                        'peer.active.1.ip': '127.0.0.1',
                        'peer.active.1.port': 50004,
                        'peer.active.1.nodeId': '328105ab6744914e61bcfcb729d741f23528fd6eb1b42628120ab027d82c9c2d8c445f8c6727e291e1abcaa8398bf47d4cca6ea6600b137b875b8df22251e325',

                        'peer.active.2.ip': '127.0.0.1',
                        'peer.active.2.port': 50006,
                        'peer.active.2.nodeId': '8ac219dc7ac6bfe401892ddd26c63f14e7cd5b62c750162c0889eee19c1725c29e52c00bc91ee260241d2e4ddcf72ed69746b226fc7c1c63f906d19a7a31988a',

                        'federator.amountOfHeadersToSend': 500,
                    },
                    bookkeepingConfigurations,
                    port: 50002,
                    rpcPort: 50003,
                    nodeId: '0b1d25b03d041028326ac5b27af941524c31bf09df5fece7476d3940f9cd2394d3cd349b9b265b7427607736dcee323d9e4a893b1d15549c928278a4e6012c08'
                },
                {
                    id: 'federator-3-third-federation',
                    federationId: 'third-federation',
                    type: 'keyfile',
                    logbackFile: `${federatesLogbackPath}/third-federation/fed3.xml`,
                    classpath: powpegNodeJarPath,
                    configFile: `${nodesConfigPath}/third-federation/fed3.conf`,
                    publicKeys: {
                        btc: '0x03328105ab6744914e61bcfcb729d741f23528fd6eb1b42628120ab027d82c9c2d',
                        rsk: '0x03328105ab6744914e61bcfcb729d741f23528fd6eb1b42628120ab027d82c9c2d',
                        mst: '0x03328105ab6744914e61bcfcb729d741f23528fd6eb1b42628120ab027d82c9c2d',
                    },
                    customConfig: {
                        'federator.signers.BTC.type': 'keyFile',
                        'federator.signers.BTC.path': path.resolve(__dirname, `${keysPathResolve}/third-federation/fed3.key`),
                        'federator.signers.RSK.type': 'keyFile',
                        'federator.signers.RSK.path': path.resolve(__dirname, `${keysPathResolve}/third-federation/fed3.key`),
                        'federator.signers.MST.type': 'keyFile',
                        'federator.signers.MST.path': path.resolve(__dirname, `${keysPathResolve}/third-federation/fed3.key`),

                        'peer.active.0.ip': '127.0.0.1',
                        'peer.active.0.port': 50000,
                        'peer.active.0.nodeId': '4ba6ec42eab139697c3614653e130e76fc15d1d7e5c91b3df63d3c06195d42265a5550cda65aa54de279a79a55e5513598b183e64f351e790d6370a6c67b141d',

                        'peer.active.1.ip': '127.0.0.1',
                        'peer.active.1.port': 50002,
                        'peer.active.1.nodeId': '0b1d25b03d041028326ac5b27af941524c31bf09df5fece7476d3940f9cd2394d3cd349b9b265b7427607736dcee323d9e4a893b1d15549c928278a4e6012c08',

                        'peer.active.2.ip': '127.0.0.1',
                        'peer.active.2.port': 50006,
                        'peer.active.2.nodeId': '8ac219dc7ac6bfe401892ddd26c63f14e7cd5b62c750162c0889eee19c1725c29e52c00bc91ee260241d2e4ddcf72ed69746b226fc7c1c63f906d19a7a31988a',

                        'federator.amountOfHeadersToSend': 500,
                    },
                    bookkeepingConfigurations,
                    port: 50004,
                    rpcPort: 50005,
                    nodeId: '328105ab6744914e61bcfcb729d741f23528fd6eb1b42628120ab027d82c9c2d8c445f8c6727e291e1abcaa8398bf47d4cca6ea6600b137b875b8df22251e325'
                },
                {
                    id: 'federator-4-third-federation',
                    federationId: 'third-federation',
                    type: 'hsm',
                    hsmPort: 9985,
                    hsmDifficultyTarget: DIFFICULTY_TARGET_IN_HEX,
                    logbackFile: `${federatesLogbackPath}/third-federation/fed4.xml`,
                    classpath: powpegNodeJarPath,
                    configFile: `${nodesConfigPath}/third-federation/fed4.conf`,
                    publicKeys: {
                        btc: '0x028ac219dc7ac6bfe401892ddd26c63f14e7cd5b62c750162c0889eee19c1725c2',
                        rsk: '0x028ac219dc7ac6bfe401892ddd26c63f14e7cd5b62c750162c0889eee19c1725c2',
                        mst: '0x028ac219dc7ac6bfe401892ddd26c63f14e7cd5b62c750162c0889eee19c1725c2',
                    },
                    customConfig: {

                        'peer.active.0.ip': '127.0.0.1',
                        'peer.active.0.port': 50000,
                        'peer.active.0.nodeId': '4ba6ec42eab139697c3614653e130e76fc15d1d7e5c91b3df63d3c06195d42265a5550cda65aa54de279a79a55e5513598b183e64f351e790d6370a6c67b141d',

                        'peer.active.1.ip': '127.0.0.1',
                        'peer.active.1.port': 50002,
                        'peer.active.1.nodeId': '0b1d25b03d041028326ac5b27af941524c31bf09df5fece7476d3940f9cd2394d3cd349b9b265b7427607736dcee323d9e4a893b1d15549c928278a4e6012c08',

                        'peer.active.2.ip': '127.0.0.1',
                        'peer.active.2.port': 50004,
                        'peer.active.2.nodeId': '328105ab6744914e61bcfcb729d741f23528fd6eb1b42628120ab027d82c9c2d8c445f8c6727e291e1abcaa8398bf47d4cca6ea6600b137b875b8df22251e325',

                        'federator.amountOfHeadersToSend': 500,
                    },
                    bookkeepingConfigurations,
                    port: 50006,
                    rpcPort: 50007,
                    nodeId: '8ac219dc7ac6bfe401892ddd26c63f14e7cd5b62c750162c0889eee19c1725c29e52c00bc91ee260241d2e4ddcf72ed69746b226fc7c1c63f906d19a7a31988a'
                }
            ]
        },
        fourthFederation: {
            federationId: 'fourth-federation',
            members: [
                {
                    id: 'federator-1-fourth-federation',
                    federationId: 'fourth-federation',
                    type: 'keyfile',
                    logbackFile: `${federatesLogbackPath}/fourth-federation/fed1.xml`,
                    classpath: powpegNodeJarPath,
                    configFile: `${nodesConfigPath}/fourth-federation/fed1.conf`,
                    publicKeys: {
                        btc: '0x033ebf25b39fa357d14afd8cf2a66207e7c2eba9e0e21d96d3026f62e2451724d2',
                        rsk: '0x033ebf25b39fa357d14afd8cf2a66207e7c2eba9e0e21d96d3026f62e2451724d2',
                        mst: '0x033ebf25b39fa357d14afd8cf2a66207e7c2eba9e0e21d96d3026f62e2451724d2',
                    },
                    customConfig: {
                        'federator.signers.BTC.type': 'keyFile',
                        'federator.signers.BTC.path': path.resolve(__dirname, `${keysPathResolve}/fourth-federation/fed1.key`),
                        'federator.signers.RSK.type': 'keyFile',
                        'federator.signers.RSK.path': path.resolve(__dirname, `${keysPathResolve}/fourth-federation/fed1.key`),
                        'federator.signers.MST.type': 'keyFile',
                        'federator.signers.MST.path': path.resolve(__dirname, `${keysPathResolve}/fourth-federation/fed1.key`),
                        
                        'peer.active.0.ip': '127.0.0.1',
                        'peer.active.0.port': 50000,
                        'peer.active.0.nodeId': '4ba6ec42eab139697c3614653e130e76fc15d1d7e5c91b3df63d3c06195d42265a5550cda65aa54de279a79a55e5513598b183e64f351e790d6370a6c67b141d',

                        'peer.active.1.ip': '127.0.0.1',
                        'peer.active.1.port': 60002,
                        'peer.active.1.nodeId': 'c60bb95e83a68a68fb090eef7e2b11d463eb7496a4f93ec35874debe97068020e0b40997586fc982d7423c0f376d0ba9a5d4ed058e51822118a88fb6f1746ea6',

                        'peer.active.2.ip': '127.0.0.1',
                        'peer.active.2.port': 60004,
                        'peer.active.2.nodeId': '4ba6ec42eab139697c3614653e130e76fc15d1d7e5c91b3df63d3c06195d42265a5550cda65aa54de279a79a55e5513598b183e64f351e790d6370a6c67b141d',

                        'peer.active.3.ip': '127.0.0.1',
                        'peer.active.3.port': 60006,
                        'peer.active.3.nodeId': '0b1d25b03d041028326ac5b27af941524c31bf09df5fece7476d3940f9cd2394d3cd349b9b265b7427607736dcee323d9e4a893b1d15549c928278a4e6012c08',
                        
                        'federator.amountOfHeadersToSend': 500,
                    },
                    bookkeepingConfigurations,
                    port: 60000,
                    rpcPort: 60001,
                    nodeId: '3ebf25b39fa357d14afd8cf2a66207e7c2eba9e0e21d96d3026f62e2451724d28e2800a5c024e62e6edad2073fc1670df7e7e7c157436c53e73bb72f1d58f88d'
                },
                {
                    id: 'federator-2-fourth-federation',
                    federationId: 'fourth-federation',
                    type: 'hsm',
                    hsmPort: 9991,
                    hsmDifficultyTarget: DIFFICULTY_TARGET_IN_HEX,
                    logbackFile: `${federatesLogbackPath}/fourth-federation/fed2.xml`,
                    classpath: powpegNodeJarPath,
                    configFile: `${nodesConfigPath}/fourth-federation/fed2.conf`,
                    publicKeys: {
                        btc: '0x02c60bb95e83a68a68fb090eef7e2b11d463eb7496a4f93ec35874debe97068020',
                        rsk: '0x02c60bb95e83a68a68fb090eef7e2b11d463eb7496a4f93ec35874debe97068020',
                        mst: '0x02c60bb95e83a68a68fb090eef7e2b11d463eb7496a4f93ec35874debe97068020',
                    },
                    customConfig: {

                        'peer.active.0.ip': '127.0.0.1',
                        'peer.active.0.port': 60000,
                        'peer.active.0.nodeId': '3ebf25b39fa357d14afd8cf2a66207e7c2eba9e0e21d96d3026f62e2451724d28e2800a5c024e62e6edad2073fc1670df7e7e7c157436c53e73bb72f1d58f88d',

                        'peer.active.1.ip': '127.0.0.1',
                        'peer.active.1.port': 60004,
                        'peer.active.1.nodeId': '4ba6ec42eab139697c3614653e130e76fc15d1d7e5c91b3df63d3c06195d42265a5550cda65aa54de279a79a55e5513598b183e64f351e790d6370a6c67b141d',

                        'peer.active.2.ip': '127.0.0.1',
                        'peer.active.2.port': 60006,
                        'peer.active.2.nodeId': '0b1d25b03d041028326ac5b27af941524c31bf09df5fece7476d3940f9cd2394d3cd349b9b265b7427607736dcee323d9e4a893b1d15549c928278a4e6012c08',

                        'federator.amountOfHeadersToSend': 500,
                    },
                    bookkeepingConfigurations,
                    port: 60002,
                    rpcPort: 60003,
                    nodeId: 'c60bb95e83a68a68fb090eef7e2b11d463eb7496a4f93ec35874debe97068020e0b40997586fc982d7423c0f376d0ba9a5d4ed058e51822118a88fb6f1746ea6'
                },
                {
                    id: 'federator-3-fourth-federation',
                    federationId: 'fourth-federation',
                    type: 'keyfile',
                    logbackFile: `${federatesLogbackPath}/fourth-federation/fed3.xml`,
                    classpath: powpegNodeJarPath,
                    configFile: `${nodesConfigPath}/fourth-federation/fed3.conf`,
                    publicKeys: {
                        btc: '0x034ba6ec42eab139697c3614653e130e76fc15d1d7e5c91b3df63d3c06195d4226',
                        rsk: '0x034ba6ec42eab139697c3614653e130e76fc15d1d7e5c91b3df63d3c06195d4226',
                        mst: '0x034ba6ec42eab139697c3614653e130e76fc15d1d7e5c91b3df63d3c06195d4226',
                    },
                    customConfig: {
                        'federator.signers.BTC.type': 'keyFile',
                        'federator.signers.BTC.path': path.resolve(__dirname, `${keysPathResolve}/fourth-federation/fed3.key`),
                        'federator.signers.RSK.type': 'keyFile',
                        'federator.signers.RSK.path': path.resolve(__dirname, `${keysPathResolve}/fourth-federation/fed3.key`),
                        'federator.signers.MST.type': 'keyFile',
                        'federator.signers.MST.path': path.resolve(__dirname, `${keysPathResolve}/fourth-federation/fed3.key`),

                        'peer.active.0.ip': '127.0.0.1',
                        'peer.active.0.port': 60000,
                        'peer.active.0.nodeId': '3ebf25b39fa357d14afd8cf2a66207e7c2eba9e0e21d96d3026f62e2451724d28e2800a5c024e62e6edad2073fc1670df7e7e7c157436c53e73bb72f1d58f88d',

                        'peer.active.1.ip': '127.0.0.1',
                        'peer.active.1.port': 60002,
                        'peer.active.1.nodeId': 'c60bb95e83a68a68fb090eef7e2b11d463eb7496a4f93ec35874debe97068020e0b40997586fc982d7423c0f376d0ba9a5d4ed058e51822118a88fb6f1746ea6',

                        'peer.active.2.ip': '127.0.0.1',
                        'peer.active.2.port': 60006,
                        'peer.active.2.nodeId': '0b1d25b03d041028326ac5b27af941524c31bf09df5fece7476d3940f9cd2394d3cd349b9b265b7427607736dcee323d9e4a893b1d15549c928278a4e6012c08',
                        
                        'federator.amountOfHeadersToSend': 500,
                    },
                    bookkeepingConfigurations,
                    port: 60004,
                    rpcPort: 60005,
                    nodeId: '4ba6ec42eab139697c3614653e130e76fc15d1d7e5c91b3df63d3c06195d42265a5550cda65aa54de279a79a55e5513598b183e64f351e790d6370a6c67b141d'
                },
                {
                    id: 'federator-4-fourth-federation',
                    federationId: 'fourth-federation',
                    type: 'hsm',
                    hsmPort: 9989,
                    hsmDifficultyTarget: DIFFICULTY_TARGET_IN_HEX,
                    logbackFile: `${federatesLogbackPath}/fourth-federation/fed4.xml`,
                    classpath: powpegNodeJarPath,
                    configFile: `${nodesConfigPath}/fourth-federation/fed4.conf`,
                    publicKeys: {
                        btc: '0x020b1d25b03d041028326ac5b27af941524c31bf09df5fece7476d3940f9cd2394',
                        rsk: '0x020b1d25b03d041028326ac5b27af941524c31bf09df5fece7476d3940f9cd2394',
                        mst: '0x020b1d25b03d041028326ac5b27af941524c31bf09df5fece7476d3940f9cd2394',
                    },
                    customConfig: {

                        'peer.active.0.ip': '127.0.0.1',
                        'peer.active.0.port': 60000,
                        'peer.active.0.nodeId': '3ebf25b39fa357d14afd8cf2a66207e7c2eba9e0e21d96d3026f62e2451724d28e2800a5c024e62e6edad2073fc1670df7e7e7c157436c53e73bb72f1d58f88d',

                        'peer.active.1.ip': '127.0.0.1',
                        'peer.active.1.port': 60002,
                        'peer.active.1.nodeId': 'c60bb95e83a68a68fb090eef7e2b11d463eb7496a4f93ec35874debe97068020e0b40997586fc982d7423c0f376d0ba9a5d4ed058e51822118a88fb6f1746ea6',

                        'peer.active.2.ip': '127.0.0.1',
                        'peer.active.2.port': 60004,
                        'peer.active.2.nodeId': '4ba6ec42eab139697c3614653e130e76fc15d1d7e5c91b3df63d3c06195d42265a5550cda65aa54de279a79a55e5513598b183e64f351e790d6370a6c67b141d',

                        'federator.amountOfHeadersToSend': 500,
                    },
                    bookkeepingConfigurations,
                    port: 60006,
                    rpcPort: 60007,
                    nodeId: '0b1d25b03d041028326ac5b27af941524c31bf09df5fece7476d3940f9cd2394d3cd349b9b265b7427607736dcee323d9e4a893b1d15549c928278a4e6012c08'
                }
            ]
        }
    },
}
