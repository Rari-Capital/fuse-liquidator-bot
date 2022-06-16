import { liquidateUnhealthyBorrows, setUpSdk } from './index';
import { JsonRpcProvider } from '@ethersproject/providers';

// Liquidate unhealthy borrows and repeat every LIQUIDATION_INTERVAL_SECONDS
export default async function liquidateAndRepeat(chainId: number, provider: JsonRpcProvider) {
  const fuse = setUpSdk(chainId, provider);
  console.log(`Config for bot: ${JSON.stringify(fuse.chainLiquidationConfig)}`);
  await liquidateUnhealthyBorrows(fuse);
  setTimeout(
    liquidateAndRepeat,
    parseInt(process.env.LIQUIDATION_INTERVAL_SECONDS || '5') * 1000,
    chainId,
    provider
  );
}
