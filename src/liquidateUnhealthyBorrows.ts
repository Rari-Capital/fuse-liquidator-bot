import { getPotentialLiquidations, sendTransactionToSafeLiquidator } from './index';
import { Fuse } from '@midas-capital/sdk';

export default async function liquidateUnhealthyBorrows(fuse: Fuse) {
  const liquidations = await getPotentialLiquidations(fuse);
  if (Object.keys(liquidations).length == 0) {
    console.log('No liquidatable pools found. Timing out and re-staring...');
  }
  for (const comptroller of Object.keys(liquidations)) {
    for (const liquidation of liquidations[comptroller]!) {
      try {
        await sendTransactionToSafeLiquidator(fuse, liquidation[0], liquidation[1], liquidation[2]);
      } catch (error) {
        throw 'Error sending sendTransactionToSafeLiquidator transaction: ' + error;
      }
    }
  }
}
