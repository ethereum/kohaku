// arkhe-gno-client.js
// JavaScript client for ARKHE Gno.land realm
// Substrato: 832.2-ORACLE-LAYER-GNOVM
// Arquiteto: ORCID 0009-0005-2697-4668

const { GnoWallet, GnoProvider } = require('@gnolang/gno-js-client');

class ArkheGnoClient {
    constructor(config = {}) {
        this.chainID = config.chainID || 'test3';
        this.rpcEndpoint = config.rpcEndpoint || 'https://rpc.gno.land';
        this.realmPath = config.realmPath || 'gno.land/r/arkherealms';
        this.provider = new GnoProvider(this.rpcEndpoint, this.chainID);
    }

    async connect(mnemonic) {
        this.wallet = await GnoWallet.fromMnemonic(mnemonic);
        this.provider.setSigner(this.wallet);
        return this;
    }

    // Register a new substrate
    async registerSubstrate(id, phiC) {
        const result = await this.provider.callMethod(
            this.realmPath,
            'RegisterSubstrate',
            [id, phiC.toString()]
        );
        return result;
    }

    // Issue a decree
    async issueDecree(substrateID, content) {
        const result = await this.provider.callMethod(
            this.realmPath,
            'IssueDecree',
            [substrateID, content]
        );
        return result;
    }

    // Anchor temporal block
    async anchorTemporalBlock(thetaID, data, phiC) {
        const result = await this.provider.callMethod(
            this.realmPath,
            'AnchorTemporalBlock',
            [thetaID, data, phiC.toString()]
        );
        return result;
    }

    // Query substrate
    async getSubstrate(id) {
        const result = await this.provider.evaluateExpression(
            this.realmPath,
            `GetStatus("${id}")`
        );
        return result;
    }

    // Query Phi-C
    async getPhiC(id) {
        const result = await this.provider.evaluateExpression(
            this.realmPath,
            `GetPhiC("${id}")`
        );
        return parseFloat(result);
    }

    // Query temporal chain
    async getTemporalChain() {
        const result = await this.provider.evaluateExpression(
            this.realmPath,
            'GetTemporalChain()'
        );
        return JSON.parse(result);
    }
}

module.exports = { ArkheGnoClient };

// Usage example:
// const client = new ArkheGnoClient();
// await client.connect('your mnemonic here');
// await client.registerSubstrate('832', 0.998);
// await client.issueDecree('832', 'Substrato 832 canonizado');
