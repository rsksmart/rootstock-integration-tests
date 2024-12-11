const path = require('path');
const nodesConfigPath = 'config/node-configs';
const keysPathResolve = 'node-keys';
const classpath = process.env.POWPEG_NODE_JAR_PATH;
const federatesLogbackPath = path.resolve(__dirname, 'logbacks');
const tcpsignerPath = process.env.TCPSIGNER_PATH;

console.log('tcpsignerPath: ', tcpsignerPath)

module.exports = {
    init: {
        mineInitialBitcoin: true,
        federatesLogbackFile: federatesLogbackPath
    },
    btc: {
        rpcUser: 'test',
        rpcPassword: 'test',
        dir: process.env.BITCOIN_DATA_DIR,
    },
    federate: [
        {
            logbackFile: `${federatesLogbackPath}/logback-fed-1.xml`,
            classpath: classpath,
            configFile: `${nodesConfigPath}/rsk-reg-1.conf`,
            publicKeys: {
                btc: '0362634ab57dae9cb373a5d536e66a8c4f67468bbcfb063809bab643072d78a124',
                rsk: '0362634ab57dae9cb373a5d536e66a8c4f67468bbcfb063809bab643072d78a124',
                mst: '0362634ab57dae9cb373a5d536e66a8c4f67468bbcfb063809bab643072d78a124',
            },
            customConfig: {
                'federator.signers.BTC.type': 'keyFile',
                'federator.signers.BTC.path': path.resolve(__dirname, `${keysPathResolve}/reg1.key`),
                'federator.signers.RSK.type': 'keyFile',
                'federator.signers.RSK.path': path.resolve(__dirname, `${keysPathResolve}/reg1.key`),
                'federator.signers.MST.type': 'keyFile',
                'federator.signers.MST.path': path.resolve(__dirname, `${keysPathResolve}/reg1.key`)
            },
            nodeId: '62634ab57dae9cb373a5d536e66a8c4f67468bbcfb063809bab643072d78a1243bd206c2c7a218d6ff4c9a185e71f066bd354e5267875b7683fbc70a1d455e87'
        },
        {
            logbackFile: `${federatesLogbackPath}/logback-fed-2.xml`,
            classpath: classpath,
            configFile: `${nodesConfigPath}/rsk-reg-2.conf`,
            publicKeys: {
                btc: '03c5946b3fbae03a654237da863c9ed534e0878657175b132b8ca630f245df04db',
                rsk: '03c5946b3fbae03a654237da863c9ed534e0878657175b132b8ca630f245df04db',
                mst: '03c5946b3fbae03a654237da863c9ed534e0878657175b132b8ca630f245df04db',
            },
            customConfig: {
                'federator.signers.BTC.type': 'keyFile',
                'federator.signers.BTC.path': path.resolve(__dirname, `${keysPathResolve}/reg2.key`),
                'federator.signers.RSK.type': 'keyFile',
                'federator.signers.RSK.path': path.resolve(__dirname, `${keysPathResolve}/reg2.key`),
                'federator.signers.MST.type': 'keyFile',
                'federator.signers.MST.path': path.resolve(__dirname, `${keysPathResolve}/reg2.key`)
            },
            nodeId: 'c5946b3fbae03a654237da863c9ed534e0878657175b132b8ca630f245df04dbb0bde4f3854613b16032fb214f9cc00f75363976ee078cc4409cdc543036ccfd'
        },
        {
            logbackFile: `${federatesLogbackPath}/logback-fed-3.xml`,
            classpath: classpath,
            configFile: `${nodesConfigPath}/rsk-reg-3.conf`,
            publicKeys: {
                btc: '02cd53fc53a07f211641a677d250f6de99caf620e8e77071e811a28b3bcddf0be1',
                rsk: '02cd53fc53a07f211641a677d250f6de99caf620e8e77071e811a28b3bcddf0be1',
                mst: '02cd53fc53a07f211641a677d250f6de99caf620e8e77071e811a28b3bcddf0be1',
            },
            customConfig: {
                'federator.signers.BTC.type': 'keyFile',
                'federator.signers.BTC.path': path.resolve(__dirname, `${keysPathResolve}/reg3.key`),
                'federator.signers.RSK.type': 'keyFile',
                'federator.signers.RSK.path': path.resolve(__dirname, `${keysPathResolve}/reg3.key`),
                'federator.signers.MST.type': 'keyFile',
                'federator.signers.MST.path': path.resolve(__dirname, `${keysPathResolve}/reg3.key`)
            },
            nodeId: 'cd53fc53a07f211641a677d250f6de99caf620e8e77071e811a28b3bcddf0be19e9da12b897b83765fbaebe717fab74fcb1b57c82f7978b8be3296239909e626'
        }
    ],
    additionalFederateNodes: [
        {
            logbackFile: `${federatesLogbackPath}/logback-fed-4.xml`,
            classpath: classpath,
            configFile: `${nodesConfigPath}/rsk-reg-4.conf`,
            publicKeys: {
                btc: '031da807c71c2f303b7f409dd2605b297ac494a563be3b9ca5f52d95a43d183cc5',
                rsk: '031da807c71c2f303b7f409dd2605b297ac494a563be3b9ca5f52d95a43d183cc5',
                mst: '031da807c71c2f303b7f409dd2605b297ac494a563be3b9ca5f52d95a43d183cc5',
            },
            customConfig: {
                'federator.signers.BTC.type': 'keyFile',
                'federator.signers.BTC.path': path.resolve(__dirname, `${keysPathResolve}/reg4.key`),
                'federator.signers.RSK.type': 'keyFile',
                'federator.signers.RSK.path': path.resolve(__dirname, `${keysPathResolve}/reg4.key`),
                'federator.signers.MST.type': 'keyFile',
                'federator.signers.MST.path': path.resolve(__dirname, `${keysPathResolve}/reg4.key`)
            },
            hsmConfigs: {
                btc: {
                  serverPath: tcpsignerPath,
                  keyPath : path.resolve(__dirname, `${keysPathResolve}/reg4-tcpsigner-v5-key.json`),
                  version: '5',
                },
            },
            nodeId: '1da807c71c2f303b7f409dd2605b297ac494a563be3b9ca5f52d95a43d183cc52191fc2bd3b06ece06b68390cbb3ba306284aed9ca7cb61dd6289e66e693126f'
        },
        {
            logbackFile: `${federatesLogbackPath}/logback-fed-5.xml`,
            classpath: classpath,
            configFile: `${nodesConfigPath}/rsk-reg-5.conf`,
            publicKeys: {
                btc: '036bb9eab797eadc8b697f0e82a01d01cabbfaaca37e5bafc06fdc6fdd38af894a',
                rsk: '036bb9eab797eadc8b697f0e82a01d01cabbfaaca37e5bafc06fdc6fdd38af894a',
                mst: '036bb9eab797eadc8b697f0e82a01d01cabbfaaca37e5bafc06fdc6fdd38af894a',
            },
            customConfig: {
                'federator.signers.BTC.type': 'keyFile',
                'federator.signers.BTC.path': path.resolve(__dirname, `${keysPathResolve}/reg5.key`),
                'federator.signers.RSK.type': 'keyFile',
                'federator.signers.RSK.path': path.resolve(__dirname, `${keysPathResolve}/reg5.key`),
                'federator.signers.MST.type': 'keyFile',
                'federator.signers.MST.path': path.resolve(__dirname, `${keysPathResolve}/reg5.key`)
            },
            hsmConfigs: {
                btc: {
                  serverPath: tcpsignerPath,
                  keyPath : path.resolve(__dirname, `${keysPathResolve}/reg4-tcpsigner-v5-key.json`),
                  version: '5',
                },
            },
            nodeId: '6bb9eab797eadc8b697f0e82a01d01cabbfaaca37e5bafc06fdc6fdd38af894a9a8cbaf526d344b5df39b80433609e006586050fd2188d30ab000b0fb6a6baaf'
        }
    ]
}
