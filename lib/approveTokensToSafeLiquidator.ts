const erc20Abi = require('../abi/ERC20.json');

const approveTokensToSafeLiquidator = async ({ erc20Address, amount, web3 }: any) => {
    // * Build data
    var token = new web3.eth.Contract(erc20Abi, erc20Address);
    var data = token.methods.approve(amount).encodeABI();

    // * Build transaction
    var tx = {
        from: process.env.ETHEREUM_ADMIN_ACCOUNT,
        to: erc20Address,
        value: 0,
        data: data,
        nonce: await web3.eth.getTransactionCount(process.env.ETHEREUM_ADMIN_ACCOUNT)
    };

    if (process.env.NODE_ENV !== "production") console.warn("Signing and sending " + erc20Address + " approval transaction:", tx);

    // * Estimate gas for transaction
    try {
        tx["gas"] = await web3.eth.estimateGas(tx);
    } catch (error) {
        throw "Failed to estimate gas before signing and sending " + erc20Address + " approval transaction: " + error;
    }

    // * Sign transaction
    try {
        var signedTx = await web3.eth.accounts.signTransaction(tx, process.env.ETHEREUM_ADMIN_PRIVATE_KEY);
    } catch (error) {
        throw "Error signing " + erc20Address + " approval transaction: " + error;
    }

    // * Send transaction
    try {
        var sentTx = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);
    } catch (error) {
        throw "Error sending " + erc20Address + " approval transaction: " + error;
    }

    console.info("Successfully sent " + erc20Address + " approval transaction:", sentTx);
    return sentTx;
}

export default approveTokensToSafeLiquidator;