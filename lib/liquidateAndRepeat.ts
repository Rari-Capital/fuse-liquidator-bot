import { liquidateUnhealthyBorrows } from ".";

// * Liquidate unhealthy borrows and repeat every LIQUIDATION_INTERVAL_SECONDS
const liquidateAndRepeat = async ({ fusePoolDirectory, fuseSafeLiquidator, web3 }) => {
    await liquidateUnhealthyBorrows({ fusePoolDirectory: fusePoolDirectory, fuseSafeLiquidator: fuseSafeLiquidator, web3: web3 });
    let interval: number = parseInt(process.env.LIQUIDATION_INTERVAL_SECONDS);
    setTimeout(liquidateAndRepeat, interval * 1000);
}

export default liquidateAndRepeat;