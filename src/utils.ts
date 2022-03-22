import { FuseAsset, SupportedChains } from '@midas-capital/sdk';
import { BigNumber, BigNumberish, utils } from 'ethers';
import { TransactionRequest } from '@ethersproject/providers';
import { Fuse } from '@midas-capital/sdk';
import { FusePoolLens } from '@midas-capital/sdk/typechain/FusePoolLens';

export const SCALE_FACTOR_ONE_18_WEI = BigNumber.from(10).pow(18);
export const SCALE_FACTOR_UNDERLYING_DECIMALS = (asset: FuseAsset) =>
  BigNumber.from(10).pow(18 - asset.underlyingDecimals.toNumber());

export type ExtendedFusePoolAssetStructOutput = FusePoolLens.FusePoolAssetStructOutput & {
  borrowBalanceWei?: BigNumber;
  supplyBalanceWei?: BigNumber;
};

export type FusePoolUserWithAssets = {
  assets: ExtendedFusePoolAssetStructOutput[];
  account: string;
  totalBorrow: BigNumberish;
  totalCollateral: BigNumberish;
  health: BigNumberish;
  debt: Array<any>;
  collateral: Array<any>;
};

export type Pool = {
  [comptrollerAddress: string]: Array<[string, Array<any>, number | BigNumber]> | null;
};

interface NativeTokenData {
  symbol: string;
  address: string;
  decimals: number;
  coingeckoId: string;
}

export const NATIVE_TOKEN_DATA: Record<number, NativeTokenData> = {
  [SupportedChains.bsc]: {
    symbol: 'BNB',
    address: '0x0000000000000000000000000000000000000000',
    decimals: 18,
    coingeckoId: 'binancecoin',
  },
  [SupportedChains.chapel]: {
    symbol: 'BNB',
    address: '0x0000000000000000000000000000000000000000',
    decimals: 18,
    coingeckoId: 'binancecoin',
  },
  [SupportedChains.ganache]: {
    symbol: 'ETH',
    address: '0x0000000000000000000000000000000000000000',
    decimals: 18,
    coingeckoId: 'ethereum',
  },
};

export async function fetchGasLimitForTransaction(
  fuse: Fuse,
  method: string,
  tx: TransactionRequest
) {
  try {
    return await fuse.provider.estimateGas(tx);
  } catch (error) {
    throw `Failed to estimate gas before signing and sending ${method} transaction: ${error}`;
  }
}

export const logLiquidation = (
  borrower: FusePoolUserWithAssets,
  exchangeToTokenAddress: string,
  liquidationAmount: BigNumber,
  liquidationTokenSymbol: string
) => {
  console.log(
    `Gathered transaction data for safeLiquidate a ${liquidationTokenSymbol} borrow:
         - Liquidation Amount: ${utils.formatEther(liquidationAmount)}
         - Underlying Collateral Token: ${borrower.collateral[0].underlyingSymbol}
         - Underlying Debt Token: ${borrower.debt[0].underlyingSymbol}
         - Exchanging liquidated tokens to: ${exchangeToTokenAddress}
         `
  );
};
