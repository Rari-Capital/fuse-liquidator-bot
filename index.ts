import dotenv from 'dotenv';
// @ts-ignore
import { liquidateAndRepeat, approveTokensToSafeLiquidator } from './src';
import { SupportedChains } from '@midas-capital/sdk';
import { JsonRpcProvider } from '@ethersproject/providers';
dotenv.config();

// Liquidate unhealthy borrows and repeat every LIQUIDATION_INTERVAL_SECONDS

(async function () {
  const chainId: number = process.env.TARGET_CHAIN_ID
    ? parseInt(process.env.TARGET_CHAIN_ID)
    : SupportedChains.ganache;
  const provider = new JsonRpcProvider(process.env.WEB3_HTTP_PROVIDER_URL);

  // console.log(`Starting liquidation bot on chain: ${chainId}`);
  // if (process.env.LIQUIDATION_STRATEGY === '') {
  //   for (const tokenAddress of process.env.SUPPORTED_OUTPUT_CURRENCIES!.split(',')) {
  //     await approveTokensToSafeLiquidator(chainId, provider, tokenAddress);
  //   }
  // }
  liquidateAndRepeat(chainId, provider);
})();
