import { sendTransactionToSafeLiquidator } from './index';
import { Fuse } from '@midas-capital/sdk';

export default async function liquidateUnhealthyBorrows(fuse: Fuse) {
  const potentialLiquidations = await fuse.getPotentialLiquidations();
  if (potentialLiquidations.length == 0) {
    console.log('No liquidatable pools found. Timing out and re-staring...');
  }
  for (const poolLiquidations of potentialLiquidations) {
    if (poolLiquidations.liquidations.length > 0) {
      for (const liquidation of poolLiquidations.liquidations) {
        try {
          await sendTransactionToSafeLiquidator(
            fuse,
            liquidation.method,
            liquidation.args,
            liquidation.value
          );
        } catch (error) {
          throw 'Error sending sendTransactionToSafeLiquidator transaction: ' + error;
        }
      }
    }
  }
}
