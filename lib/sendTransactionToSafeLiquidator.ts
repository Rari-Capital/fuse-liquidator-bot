
const sendTransactionToSafeLiquidator = async (method, params, value) => {
    // * Build data
    var data = fuseSafeLiquidator.methods[method](...params).encodeABI();

    // * Build transaction
    var tx = {
        from: process.env.ETHEREUM_ADMIN_ACCOUNT,
        to: fuseSafeLiquidator.options.address,
        value: value,
        data: data,
        nonce: await web3.eth.getTransactionCount(process.env.ETHEREUM_ADMIN_ACCOUNT)
    };

    if (process.env.NODE_ENV !== "production") console.log("Signing and sending" + method + "transaction:", tx);

    // * Estimate gas for transaction
    try {
        tx["gas"] = await web3.eth.estimateGas(tx);
    } catch (error) {
        throw "Failed to estimate gas before signing and sending" + method + "transaction: " + error;
    }

    // * Sign transaction
    try {
        var signedTx = await web3.eth.accounts.signTransaction(tx, process.env.ETHEREUM_ADMIN_PRIVATE_KEY);
    } catch (error) {
        throw "Error signing" + method + "transaction: " + error;
    }

    // * Send transaction
    try {
        var sentTx = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);
    } catch (error) {
        throw "Error sending" + method + "transaction: " + error;
    }

    console.log("Successfully sent" + method + "transaction:", sentTx);
    return sentTx;
}

export default sendTransactionToSafeLiquidator;