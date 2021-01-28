import { liquidateUnhealthyBorrows } from ".";

// * Liquidate unhealthy borrows and repeat every LIQUIDATION_INTERVAL_SECONDS
const liquidateAndRepeat = async () => {
    await liquidateUnhealthyBorrows();
    let interval: number = parseInt(process.env.LIQUIDATION_INTERVAL_SECONDS);
    setTimeout(liquidateAndRepeat, interval * 1000);
}

export default liquidateAndRepeat;