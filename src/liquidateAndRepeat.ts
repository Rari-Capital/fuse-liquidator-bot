import { liquidateUnhealthyBorrows, setUpSdk } from './index';
import { JsonRpcProvider } from '@ethersproject/providers';

export default async function liquidateAndRepeat(chainId: number, provider: JsonRpcProvider) {
  const fuse = setUpSdk(chainId, provider);
  await liquidateUnhealthyBorrows(fuse);
  setTimeout(
    liquidateAndRepeat,
    parseInt(process.env.LIQUIDATION_INTERVAL_SECONDS || '5') * 1000,
    chainId,
    provider
  );
}
