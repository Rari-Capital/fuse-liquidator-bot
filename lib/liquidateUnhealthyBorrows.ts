const sendTransactionToSafeLiquidator = require('./sendTransactionToSafeLiquidator')

const liquidateUnhealthyBorrows = async () => {
    var liquidations = await getPotentialLiquidations();

    for (const comptroller of Object.keys(liquidations)) {
        for (const liquidation of liquidations[comptroller]) {
            try {
                await sendTransactionToSafeLiquidator(liquidation[0], liquidation[1], liquidation[2]);
            } catch { /* IGNORE */ }
        }
    }
}

export default liquidateUnhealthyBorrows;