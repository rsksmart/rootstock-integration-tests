const path = require('path');
const nodesConfigPath = 'config/node-configs';
const keysPathResolve = 'node-keys';
const keysPath = 'config/node-keys';
const classpath = process.env.POWPEG_NODE_JAR_PATH;
const federatesLogbackPath = path.resolve(__dirname, 'logback');
const hsmV2ServerPath = process.env.HSM2_SIM_PATH;

module.exports = {
    init: {
        mineInitialBitcoin: true,
        federatesLogbackFile: federatesLogbackPath
    },
    btc: {
        rpcUser: 'test',
        rpcPassword: 'test'
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
            nodeId: '72634ab57dae9cb373a5d536e76a8c4f67468bbcfb063809bab643072d78a1243bd206c2c7a218d6ff4c9a185e71f066bd354e5267875b7683fbc70a1d455e84'
        },
        {
            logbackFile: `${federatesLogbackPath}/logback-fed-5.xml`,
            classpath: classpath,
            configFile: `${nodesConfigPath}/rsk-reg-5.conf`,
            hsmConfigs: {
                btc: {
                    version: '2',
                    useDocker: true,
                    useLogger: true,
                    serverPath: hsmV2ServerPath,
                    keyPath: `${keysPath}/reg5-v2-key.json`
                },
                rsk: {
                    useDocker: true,
                    useLogger: true,
                    version: '2',
                    serverPath: hsmV2ServerPath,
                    keyPath: `${keysPath}/reg5-v2-key.json`,
                },
                mst: {
                    useDocker: true,
                    useLogger: true,
                    version: '2',
                    serverPath: hsmV2ServerPath,
                    keyPath: `${keysPath}/reg5-v2-key.json`,
                },
            },
            nodeId: '82634ab57dae9cb373a5d536e76a8c4f67468bbcfb063809bab643072d78a1243bd206c2c7a218d6ff4c9a185e71f066bd354e5267875b7683fbc70a1d455e85',
            customConfig: {}
        }
    ]
}
