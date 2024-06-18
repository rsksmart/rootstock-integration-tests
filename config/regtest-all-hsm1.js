const path = require('path');

const nodesConfigPath = 'config/node-configs/';
const keysPathResolve = 'node-keys/';
const keysPath = 'config/node-keys/';
const classpath = process.env.POWPEG_NODE_JAR_PATH;
const hsmV1ServerPath = process.env.HSM1_FEDHM_MOCKUP_PATH;
const federatesLogbackPath = path.resolve(__dirname, 'logback');

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
        configFile: nodesConfigPath + 'rsk-reg-1.conf',
        publicKeys: {
          btc: '0362634ab57dae9cb373a5d536e66a8c4f67468bbcfb063809bab643072d78a124',
          rsk: '0362634ab57dae9cb373a5d536e66a8c4f67468bbcfb063809bab643072d78a124',
          mst: '0362634ab57dae9cb373a5d536e66a8c4f67468bbcfb063809bab643072d78a124',
        },
        customConfig: {
          'federator.signers.BTC.type': 'keyFile',
          'federator.signers.BTC.path': path.resolve(__dirname, `${keysPathResolve}reg1.key`),
          'federator.signers.RSK.type': 'keyFile',
          'federator.signers.RSK.path': path.resolve(__dirname, `${keysPathResolve}reg1.key`),
          'federator.signers.MST.type': 'keyFile',
          'federator.signers.MST.path': path.resolve(__dirname, `${keysPathResolve}reg1.key`)
        },
        nodeId: '62634ab57dae9cb373a5d536e66a8c4f67468bbcfb063809bab643072d78a1243bd206c2c7a218d6ff4c9a185e71f066bd354e5267875b7683fbc70a1d455e87'
    },
    {
        logbackFile: `${federatesLogbackPath}/logback-fed-2.xml`,
        classpath: classpath,
        configFile: nodesConfigPath + 'rsk-reg-2.conf',
        hsmConfigs: {
          btc: {
            serverPath: hsmV1ServerPath,
            keyPath : keysPath + 'reg2.key'
          },
          rsk: {
            serverPath: hsmV1ServerPath,
            keyPath : keysPath + 'reg2.key',
          },
          mst: {
            serverPath: hsmV1ServerPath,
            keyPath : keysPath + 'reg2.key',
          },
        },
        nodeId: 'c5946b3fbae03a654237da863c9ed534e0878657175b132b8ca630f245df04dbb0bde4f3854613b16032fb214f9cc00f75363976ee078cc4409cdc543036ccfd',
        customConfig: {}
    },
    {
      logbackFile: `${federatesLogbackPath}/logback-fed-3.xml`,
      classpath: classpath,
       configFile: nodesConfigPath + 'rsk-reg-3.conf',
       hsmConfigs: {
         btc: {
            serverPath: hsmV1ServerPath,
            keyPath : keysPath + 'reg3.key',
          },
          rsk: {
            serverPath: hsmV1ServerPath,
            keyPath : keysPath + 'reg3.key',
          },
          mst: {
            serverPath: hsmV1ServerPath,
            keyPath : keysPath + 'reg3.key',
          },
       },
       nodeId: 'cd53fc53a07f211641a677d250f6de99caf620e8e77071e811a28b3bcddf0be19e9da12b897b83765fbaebe717fab74fcb1b57c82f7978b8be3296239909e626',
       customConfig: {}
    }
  ],
  additionalFederateNodes: [
    {
      logbackFile: customLogbackFile4,
       classpath: classpath,
       configFile: nodesConfigPath + 'rsk-reg-4.conf',
       hsmConfigs: {
        btc: {
           serverPath: hsmV1ServerPath,
           keyPath : keysPath + 'reg4.key',
         },
         rsk: {
           serverPath: hsmV1ServerPath,
           keyPath : keysPath + 'reg4.key',
         },
         mst: {
           serverPath: hsmV1ServerPath,
           keyPath : keysPath + 'reg4.key',
         },
      },
       nodeId: '72634ab57dae9cb373a5d536e76a8c4f67468bbcfb063809bab643072d78a1243bd206c2c7a218d6ff4c9a185e71f066bd354e5267875b7683fbc70a1d455e84',
       customConfig: {}
    },
    {
      logbackFile: customLogbackFile5,
       classpath: classpath,
       configFile: nodesConfigPath + 'rsk-reg-5.conf',
       hsmConfigs: {
        btc: {
           serverPath: hsmV1ServerPath,
           keyPath : keysPath + 'reg5.key',
         },
         rsk: {
           serverPath: hsmV1ServerPath,
           keyPath : keysPath + 'reg5.key',
         },
         mst: {
           serverPath: hsmV1ServerPath,
           keyPath : keysPath + 'reg5.key',
         },
      },
       nodeId: '82634ab57dae9cb373a5d536e76a8c4f67468bbcfb063809bab643072d78a1243bd206c2c7a218d6ff4c9a185e71f066bd354e5267875b7683fbc70a1d455e85',
       customConfig: {}
    }
  ]
}