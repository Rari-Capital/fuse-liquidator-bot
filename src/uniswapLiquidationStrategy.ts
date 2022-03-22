import { BigNumber, constants } from 'ethers';
import {
  safeLiquidateWithFlashLoanNativeDebtEncodeTx,
  safeLiquidateWithFlashLoanNativeDebtEstimateGas,
  safeLiquidateWithFlashLoanTokenDebtEncodeTx,
  safeLiquidateWithFlashLoanTokenDebtEstimateGas,
} from './safeLiquidateWithFlashLoan';
import { Fuse } from '@midas-capital/sdk';
import { FusePoolUserWithAssets } from './utils';
import { StrategyAndData } from './redemptionStrategy';

export const uniswapLiquidationStrategy = async (
  fuse: Fuse,
  borrower: FusePoolUserWithAssets,
  liquidationAmount: BigNumber,
  exchangeToTokenAddress: string,
  outputPrice: BigNumber,
  outputDecimals: BigNumber,
  strategyAndData: StrategyAndData
) => {
  let expectedGasAmount: BigNumber;
  // liquidationAmount = liquidationAmount.div(1e9);
  // Estimate gas usage
  try {
    if (borrower.debt[0].underlyingToken === constants.AddressZero) {
      expectedGasAmount = await safeLiquidateWithFlashLoanNativeDebtEstimateGas(
        fuse,
        borrower,
        exchangeToTokenAddress,
        liquidationAmount,
        strategyAndData
      );
    } else {
      expectedGasAmount = await safeLiquidateWithFlashLoanTokenDebtEstimateGas(
        fuse,
        borrower,
        exchangeToTokenAddress,
        liquidationAmount,
        strategyAndData
      );
    }
  } catch {
    expectedGasAmount = BigNumber.from(750000);
  }

  // Get gas fee
  const gasPrice = await fuse.provider.getGasPrice();
  const expectedGasFee = gasPrice.mul(expectedGasAmount);

  // Get min profit
  const minOutputEth = BigNumber.from(process.env.MINIMUM_PROFIT_NATIVE).add(expectedGasFee);
  const minProfitAmountScaled = minOutputEth
    .div(outputPrice)
    .mul(BigNumber.from(10).pow(outputDecimals));

  // Return transaction
  if (borrower.debt[0].underlyingToken === constants.AddressZero) {
    return safeLiquidateWithFlashLoanNativeDebtEncodeTx(
      fuse,
      borrower,
      exchangeToTokenAddress,
      liquidationAmount,
      minProfitAmountScaled,
      strategyAndData
    );
  } else {
    return safeLiquidateWithFlashLoanTokenDebtEncodeTx(
      fuse,
      borrower,
      exchangeToTokenAddress,
      liquidationAmount,
      strategyAndData
    );
  }
};
