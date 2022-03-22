import { Fuse } from '@midas-capital/sdk';
import { FusePoolUserWithAssets, logLiquidation, NATIVE_TOKEN_DATA } from './utils';
import { BigNumber } from 'ethers';
import { StrategyAndData } from './redemptionStrategy';

export const safeLiquidateWithFlashLoanTokenDebtEncodeTx = (
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
    borrower.debt[0].underlyingSymbol
  );
  return [
    'safeLiquidateToTokensWithFlashLoan',
    [
      borrower.account,
      liquidationAmount,
      borrower.debt[0].cToken,
      borrower.collateral[0].cToken,
      0,
      exchangeToTokenAddress,
      fuse.chainSpecificAddresses.UNISWAP_V2_ROUTER,
      fuse.chainSpecificAddresses.UNISWAP_V2_ROUTER,
      strategyAndData.strategyAddress,
      strategyAndData.strategyData,
      0,
    ],
    BigNumber.from(0),
  ];
};

export const safeLiquidateWithFlashLoanNativeDebtEncodeTx = (
  fuse: Fuse,
  borrower: FusePoolUserWithAssets,
  exchangeToTokenAddress: string,
  liquidationAmount: BigNumber,
  minProfitAmountScaled: BigNumber,
  strategyAndData: StrategyAndData
): [string, any, BigNumber] => {
  logLiquidation(
    borrower,
    exchangeToTokenAddress,
    liquidationAmount,
    NATIVE_TOKEN_DATA[fuse.chainId].symbol
  );
  return [
    'safeLiquidateToEthWithFlashLoan',
    [
      borrower.account,
      liquidationAmount.div(20),
      borrower.debt[0].cToken,
      borrower.collateral[0].cToken,
      minProfitAmountScaled,
      exchangeToTokenAddress,
      fuse.chainSpecificAddresses.UNISWAP_V2_ROUTER,
      strategyAndData.strategyAddress,
      strategyAndData.strategyData,
      0,
    ],
    BigNumber.from(0),
  ];
};

export const safeLiquidateWithFlashLoanNativeDebtEstimateGas = async (
  fuse: Fuse,
  borrower: FusePoolUserWithAssets,
  exchangeToTokenAddress: string,
  liquidationAmount: BigNumber,
  strategyAndData: StrategyAndData
) => {
  return await fuse.contracts.FuseSafeLiquidator.estimateGas.safeLiquidateToEthWithFlashLoan(
    borrower.account,
    liquidationAmount,
    borrower.debt[0].cToken,
    borrower.collateral[0].cToken,
    0,
    exchangeToTokenAddress,
    fuse.chainSpecificAddresses.UNISWAP_V2_ROUTER,
    strategyAndData.strategyAddress,
    strategyAndData.strategyData,
    0,
    {
      gasLimit: 1e9,
      from: process.env.ETHEREUM_ADMIN_ACCOUNT,
    }
  );
};

export const safeLiquidateWithFlashLoanTokenDebtEstimateGas = async (
  fuse: Fuse,
  borrower: FusePoolUserWithAssets,
  exchangeToTokenAddress: string,
  liquidationAmount: BigNumber,
  strategyAndData: StrategyAndData
) => {
  return await fuse.contracts.FuseSafeLiquidator.estimateGas.safeLiquidateToTokensWithFlashLoan(
    borrower.account,
    liquidationAmount,
    borrower.debt[0].cToken,
    borrower.collateral[0].cToken,
    0,
    exchangeToTokenAddress,
    fuse.chainSpecificAddresses.UNISWAP_V2_ROUTER,
    fuse.chainSpecificAddresses.UNISWAP_V2_ROUTER,
    strategyAndData.strategyAddress,
    strategyAndData.strategyData,
    0,
    {
      gasLimit: 1e9,
      from: process.env.ETHEREUM_ADMIN_ACCOUNT,
    }
  );
};
