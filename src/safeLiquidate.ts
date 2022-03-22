import { Fuse } from '@midas-capital/sdk';
import { FusePoolUserWithAssets, logLiquidation, NATIVE_TOKEN_DATA } from './utils';
import { BigNumber } from 'ethers';
import { StrategyAndData } from './redemptionStrategy';

export const safeLiquidateTokenDebtEncodeTx = (
  borrower: FusePoolUserWithAssets,
  exchangeToTokenAddress: string,
  liquidationAmount: BigNumber,
  strategyAndData: StrategyAndData
): [string, any, BigNumber] => {
  logLiquidation(
    borrower,
    exchangeToTokenAddress,
    liquidationAmount,
    borrower.debt[0].underlyingSymbol
  );
  return [
    'safeLiquidate(address,uint256,address,address,uint256,address,address,address[],bytes[])',
    [
      borrower.account,
      liquidationAmount,
      borrower.debt[0].cToken,
      borrower.collateral[0].cToken,
      0,
      borrower.collateral[0].cToken,
      exchangeToTokenAddress,
      strategyAndData.strategyAddress,
      strategyAndData.strategyData,
    ],
    BigNumber.from(0),
  ];
};

export const safeLiquidateNativeDebtEncodeTx = (
  fuse: Fuse,
  borrower: FusePoolUserWithAssets,
  exchangeToTokenAddress: string,
  liquidationAmount: BigNumber,
  strategyAndData: StrategyAndData
): [string, any, BigNumber] => {
  logLiquidation(
    borrower,
    exchangeToTokenAddress,
    liquidationAmount,
    NATIVE_TOKEN_DATA[fuse.chainId].symbol
  );
  return [
    'safeLiquidate(address,address,address,uint256,address,address,address[],bytes[])',
    [
      borrower.account,
      borrower.debt[0].cToken,
      borrower.collateral[0].cToken,
      0,
      borrower.collateral[0].cToken,
      exchangeToTokenAddress,
      strategyAndData.strategyAddress,
      strategyAndData.strategyData,
    ],
    liquidationAmount,
  ];
};

export const safeLiquidateNativeDebtEstimateGas = async (
  fuse: Fuse,
  borrower: FusePoolUserWithAssets,
  exchangeToTokenAddress: string,
  liquidationAmount: BigNumber,
  strategyAndData: StrategyAndData
) => {
  return await fuse.contracts.FuseSafeLiquidator.estimateGas[
    'safeLiquidate(address,address,address,uint256,address,address,address[],bytes[])'
  ](
    borrower.account,
    borrower.debt[0].cToken,
    borrower.collateral[0].cToken,
    0,
    exchangeToTokenAddress,
    fuse.chainSpecificAddresses.UNISWAP_V2_ROUTER,
    strategyAndData.strategyAddress,
    strategyAndData.strategyData,
    {
      gasLimit: 1e9,
      value: liquidationAmount,
      from: process.env.ETHEREUM_ADMIN_ACCOUNT,
    }
  );
};

export const safeLiquidateTokenDebtEstimateGas = async (
  fuse: Fuse,
  borrower: FusePoolUserWithAssets,
  exchangeToTokenAddress: string,
  liquidationAmount: BigNumber,
  strategyAndData: StrategyAndData
) => {
  return await fuse.contracts.FuseSafeLiquidator.estimateGas[
    'safeLiquidate(address,uint256,address,address,uint256,address,address,address[],bytes[])'
  ](
    borrower.account,
    liquidationAmount,
    borrower.debt[0].cToken,
    borrower.collateral[0].cToken,
    0,
    exchangeToTokenAddress,
    fuse.chainSpecificAddresses.UNISWAP_V2_ROUTER,
    strategyAndData.strategyAddress,
    strategyAndData.strategyData,
    {
      gasLimit: 1e9,
      from: process.env.ETHEREUM_ADMIN_ACCOUNT,
    }
  );
};
