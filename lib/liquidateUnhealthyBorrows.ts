import { getPotentialLiquidations } from ".";

const sendTransactionToSafeLiquidator = require('./sendTransactionToSafeLiquidator')

const liquidateUnhealthyBorrows = async ({ fusePoolDirectory, fuseSafeLiquidator, web3 }) => {
    var liquidations = await getPotentialLiquidations({ fusePoolDirectory, fuseSafeLiquidator, web3 });

    for (const comptroller of Object.keys(liquidations)) {
        for (const liquidation of liquidations[comptroller]) {
            try {
                await sendTransactionToSafeLiquidator({ method: liquidation[0], params: liquidation[1], value: liquidation[2], fuseSafeLiquidator, web3 });
            } catch { /* IGNORE */ }
        }
    }
}

export default liquidateUnhealthyBorrows;