const { expect } = require('chai');
const fs = require('node:fs');
const path = require('node:path');
const {
    MAX_FEDERATORS_COUNT,
    GENESIS_FEDERATION_PUBLIC_KEYS,
    getRequiredSignaturesCount,
} = require('../lib/federator-keys');
const {
    DEFAULT_BASE_PORT,
    KEY_FILE_MODE,
    RPC_TIMEOUT_IN_MILLISECONDS,
} = require('../lib/federation-config-builder');

const GENESIS_FEDERATION_SIZE = 3;

// The ports the regular regtest configs occupy. A manual scenario must stay out of them so both
// can be running at the same time.
const REGULAR_SUITE_PORT_RANGE = { from: 30000, to: 30099 };

const getPeerEntries = (member) =>
    Object.keys(member.customConfig)
        .filter((key) => /^peer\.active\.\d+\.nodeId$/.test(key))
        .map((key) => member.customConfig[key]);

describe('Federation growth scenario configuration', function () {
    let config;

    before(() => {
        config = require('./config');
    });

    it('should configure the whole federator pool, not just the nodes it starts', () => {
        expect(config.nodePool).to.have.lengthOf(MAX_FEDERATORS_COUNT);
    });

    it('should start half of the genesis federation plus one', () => {
        const expectedNodesCount = getRequiredSignaturesCount(GENESIS_FEDERATION_SIZE);
        expect(expectedNodesCount, 'half plus one of 3 should be 2').to.equal(2);
        expect(config.federations.genesisFederation.members).to.have.lengthOf(expectedNodesCount);
    });

    it('should start the federators the Bridge has as the regtest genesis federation', () => {
        // rskj hardcodes these in BridgeRegTestConstants, and the scenario leaves that default
        // alone, so a node started here has to be one of them or the Bridge will not know it.
        const startedPublicKeys = config.federations.genesisFederation.members.map((member) =>
            member.publicKeys.btc.replace(/^0x/, '')
        );
        for (const publicKey of startedPublicKeys) {
            expect(
                GENESIS_FEDERATION_PUBLIC_KEYS,
                `${publicKey} is not one of rskj's regtest genesis federation keys`
            ).to.include(publicKey);
        }
    });

    it('should give every node its own ports, clear of the regular suite', () => {
        const allPorts = config.nodePool.flatMap((member) => [member.port, member.rpcPort]);

        expect(new Set(allPorts).size, 'two nodes were given the same port').to.equal(
            allPorts.length
        );
        expect(Math.min(...allPorts)).to.be.at.least(DEFAULT_BASE_PORT);
        for (const port of allPorts) {
            const collides =
                port >= REGULAR_SUITE_PORT_RANGE.from && port <= REGULAR_SUITE_PORT_RANGE.to;
            expect(collides, `port ${port} is inside the range the regular regtest configs use`).to
                .be.false;
        }
    });

    it('should peer every node with the whole pool, including nodes it has not started', () => {
        // A running node never re-reads its peer list, so the nodes started later have to already
        // be in it. Until they come up they are just peers that do not answer.
        for (const member of config.nodePool) {
            const peerNodeIds = getPeerEntries(member);

            expect(
                peerNodeIds,
                `${member.id} is not peered with the rest of the pool`
            ).to.have.lengthOf(MAX_FEDERATORS_COUNT - 1);
            expect(peerNodeIds, `${member.id} lists itself as a peer`).to.not.include(
                member.nodeId
            );
            expect(new Set(peerNodeIds).size, `${member.id} lists a peer twice`).to.equal(
                peerNodeIds.length
            );
        }
    });

    it('should write every federator a key file the node can read', () => {
        for (const member of config.nodePool) {
            const keyFilePath = member.customConfig['federator.signers.BTC.path'];

            expect(fs.existsSync(keyFilePath), `${member.id} has no key file at ${keyFilePath}`).to
                .be.true;
            expect(
                fs.readFileSync(keyFilePath, 'utf8').trim(),
                `${member.id}'s key file does not hold its peer key`
            ).to.equal(member.customConfig['peer.privateKey']);

            // The node refuses to start on anything but owner-read, see KeyFileChecker.
            const mode = fs.statSync(keyFilePath).mode & 0o777;
            expect(
                mode.toString(8),
                `${member.id}'s key file permissions will be rejected by the node`
            ).to.equal(KEY_FILE_MODE.toString(8));
        }
    });

    it('should sign with key files only, with the same key for BTC, RSK and MST', () => {
        for (const member of config.nodePool) {
            for (const keyType of ['BTC', 'RSK', 'MST']) {
                expect(member.customConfig[`federator.signers.${keyType}.type`]).to.equal(
                    'keyFile'
                );
                expect(member.customConfig[`federator.signers.${keyType}.path`]).to.equal(
                    member.customConfig['federator.signers.BTC.path']
                );
            }
            expect(member.type, `${member.id} is not a plain key file node`).to.be.undefined;
        }
    });

    it('should point every node at a powpeg node jar and a readable base config', () => {
        for (const member of config.nodePool) {
            expect(
                fs.existsSync(member.classpath),
                `${member.id} points at a jar that is not there: ${member.classpath}`
            ).to.be.true;
            expect(
                fs.existsSync(member.configFile),
                `${member.id} points at a base config that is not there: ${member.configFile}`
            ).to.be.true;
        }

        const baseConfigFiles = new Set(config.nodePool.map((member) => member.configFile));
        expect(baseConfigFiles.size, 'the pool should share one base config file').to.equal(1);
    });

    it('should give every node an rpc timeout long enough for a busy machine', () => {
        // The node default is five seconds, which a single evm_mine can exceed once ten JVMs are
        // running. Losing this override turns a long run into a flaky one.
        for (const member of config.nodePool) {
            expect(
                member.customConfig['rpc.timeout'],
                `${member.id} would use the node's own short rpc timeout`
            ).to.equal(RPC_TIMEOUT_IN_MILLISECONDS);
        }
        expect(RPC_TIMEOUT_IN_MILLISECONDS).to.be.at.least(60000);
    });

    it('should give every node its own logback file path', () => {
        const logbackFiles = config.nodePool.map((member) => member.logbackFile);
        expect(new Set(logbackFiles).size).to.equal(logbackFiles.length);
        for (const logbackFile of logbackFiles) {
            expect(path.isAbsolute(logbackFile)).to.be.true;
        }
    });
});
