import { BigNumber, constants, utils } from 'ethers';
import {
  safeLiquidateNativeDebtEncodeTx,
  safeLiquidateNativeDebtEstimateGas,
  safeLiquidateTokenDebtEncodeTx,
  safeLiquidateTokenDebtEstimateGas,
} from './safeLiquidate';
import { FusePoolUserWithAssets, SCALE_FACTOR_ONE_18_WEI } from './utils';
import { Fuse } from '@midas-capital/sdk';
import { StrategyAndData } from './redemptionStrategy';

export const defaultLiquidationStrategy = async (
  fuse: Fuse,
  borrower: FusePoolUserWithAssets,
  exchangeToTokenAddress: string,
  liquidationAmount: BigNumber,
  liquidationValueWei: BigNumber,
  outputPrice: BigNumber,
  seizeAmount: BigNumber,
  strategyAndData: StrategyAndData
) => {
  let expectedGasAmount: BigNumber;
  try {
    if (borrower.debt[0].underlyingToken === constants.AddressZero) {
      expectedGasAmount = await safeLiquidateNativeDebtEstimateGas(
        fuse,
        borrower,
        exchangeToTokenAddress,
        liquidationAmount,
        strategyAndData
      );
    } else {
      expectedGasAmount = await safeLiquidateTokenDebtEstimateGas(
        fuse,
        borrower,
        exchangeToTokenAddress,
        liquidationAmount,
        strategyAndData
      );
    }
  } catch {
    expectedGasAmount = BigNumber.from(600000);
  }

  // Get gas fee
  const gasPrice = await fuse.provider.getGasPrice();
  const expectedGasFee = gasPrice.mul(expectedGasAmount);

  // Get min seize
  const minEthSeizeAmountBreakEven = expectedGasFee.add(liquidationValueWei);
  const minEthSeizeAmount = minEthSeizeAmountBreakEven.add(
    BigNumber.from(utils.parseEther(process.env.MINIMUM_PROFIT_NATIVE!))
  );
  const minSeizeAmount = minEthSeizeAmount.mul(SCALE_FACTOR_ONE_18_WEI).div(outputPrice);

  // Check expected seize against minSeizeAmount
  if (seizeAmount.lt(minSeizeAmount)) {
    console.log(
      `Seize amount of ${utils.formatEther(
        seizeAmount
      )} less than min break even of ${minSeizeAmount}, doing nothing`
    );
    return null;
  }

  // Return transaction
  if (borrower.debt[0].underlyingToken === constants.AddressZero) {
    return safeLiquidateNativeDebtEncodeTx(
      fuse,
      borrower,
      exchangeToTokenAddress,
      liquidationAmount,
      strategyAndData
    );
  } else {
    return safeLiquidateTokenDebtEncodeTx(
      borrower,
      exchangeToTokenAddress,
      liquidationAmount,
      strategyAndData
    );
  }
};
