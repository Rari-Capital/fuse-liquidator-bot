import {
  FusePoolUserWithAssets,
  SCALE_FACTOR_ONE_18_WEI,
  SCALE_FACTOR_UNDERLYING_DECIMALS,
} from './utils';
import { BigNumber, constants, utils } from 'ethers';
import { Fuse } from '@midas-capital/sdk';
import { defaultLiquidationStrategy } from './defaultLiquidationStrategy';
import { uniswapLiquidationStrategy } from './uniswapLiquidationStrategy';
import { getStrategyAndData } from './redemptionStrategy';

export default async function getPotentialLiquidation(
  fuse: Fuse,
  borrower: FusePoolUserWithAssets,
  closeFactor: BigNumber,
  liquidationIncentive: BigNumber
): Promise<[string, Array<any>, number | BigNumber] | null> {
  // Get debt and collateral
  borrower = { ...borrower };

  for (let asset of borrower.assets!) {
    asset = { ...asset };
    asset.borrowBalanceWei = asset.borrowBalance
      .mul(asset.underlyingPrice)
      .div(SCALE_FACTOR_ONE_18_WEI);
    asset.supplyBalanceWei = asset.supplyBalance
      .mul(asset.underlyingPrice)
      .div(SCALE_FACTOR_ONE_18_WEI);
    if (asset.borrowBalance.gt(0)) borrower.debt.push(asset);
    if (asset.membership && asset.supplyBalance.gt(0)) borrower.collateral.push(asset);
  }

  // Sort debt and collateral from highest to lowest ETH value
  borrower.debt.sort((a, b) => (b.borrowBalanceWei.gt(a.borrowBalanceWei) ? 1 : -1));
  borrower.collateral.sort((a, b) => (b.supplyBalanceWei.gt(a.supplyBalanceWei) ? 1 : -1));

  // Check SUPPORTED_INPUT_CURRENCIES (if LIQUIDATION_STRATEGY === "")
  if (
    process.env.LIQUIDATION_STRATEGY === '' &&
    process.env.SUPPORTED_INPUT_CURRENCIES!.split(',').indexOf(borrower.debt[0].underlyingToken) < 0
  )
    return null;

  let outputPrice: BigNumber;
  let outputDecimals: BigNumber;
  let exchangeToTokenAddress: string;

  // Check SUPPORTED_OUTPUT_CURRENCIES: replace EXCHANGE_TO_TOKEN_ADDRESS with underlying collateral if underlying collateral is in SUPPORTED_OUTPUT_CURRENCIES
  if (
    process.env
      .SUPPORTED_OUTPUT_CURRENCIES!.split(',')
      .indexOf(borrower.collateral[0].underlyingToken) >= 0
  ) {
    exchangeToTokenAddress = borrower.collateral[0].underlyingToken;
    outputPrice = borrower.collateral[0].underlyingPrice;
    outputDecimals = borrower.collateral[0].underlyingDecimals;
  } else {
    exchangeToTokenAddress = constants.AddressZero;
    outputPrice = utils.parseEther('1');
    outputDecimals = BigNumber.from(18);
  }

  // Get debt and collateral prices
  const underlyingDebtPrice = borrower.debt[0].underlyingPrice.div(
    SCALE_FACTOR_UNDERLYING_DECIMALS(borrower.debt[0])
  );
  const underlyingCollateralPrice = borrower.collateral[0].underlyingPrice.div(
    SCALE_FACTOR_UNDERLYING_DECIMALS(borrower.collateral[0])
  );

  // Get liquidation amount
  let liquidationAmount = borrower.debt[0].borrowBalance
    .mul(closeFactor)
    .div(BigNumber.from(10).pow(borrower.debt[0].underlyingDecimals.toNumber()));

  let liquidationValueWei = liquidationAmount.mul(underlyingDebtPrice).div(SCALE_FACTOR_ONE_18_WEI);

  // Get seize amount
  let seizeAmountWei = liquidationValueWei.mul(liquidationIncentive).div(SCALE_FACTOR_ONE_18_WEI);
  let seizeAmount = seizeAmountWei.mul(SCALE_FACTOR_ONE_18_WEI).div(underlyingCollateralPrice);

  // Check if actual collateral is too low to seize seizeAmount; if so, recalculate liquidation amount
  const actualCollateral = borrower.collateral[0].supplyBalance.div(
    SCALE_FACTOR_UNDERLYING_DECIMALS(borrower.collateral[0])
  );

  if (seizeAmount.gt(actualCollateral)) {
    seizeAmount = actualCollateral;
    seizeAmountWei = seizeAmount.mul(underlyingCollateralPrice);
    liquidationValueWei = seizeAmountWei.div(liquidationIncentive);
    liquidationAmount = liquidationValueWei.mul(SCALE_FACTOR_ONE_18_WEI).div(underlyingDebtPrice);
  }
  // liquidationAmount = liquidationAmount.mul(5);
  console.log(utils.formatEther(liquidationAmount));

  if (liquidationAmount.lte(BigNumber.from(0))) {
    console.log('Liquidation amount is zero, doing nothing');
    return null;
  }
  // Depending on liquidation strategy
  const strategyAndData = await getStrategyAndData(fuse, borrower.collateral[0].underlyingToken);
  if (process.env.LIQUIDATION_STRATEGY === '') {
    return await defaultLiquidationStrategy(
      fuse,
      borrower,
      exchangeToTokenAddress,
      liquidationAmount,
      liquidationValueWei,
      outputPrice,
      seizeAmount,
      strategyAndData
    );
  } else if (process.env.LIQUIDATION_STRATEGY === 'uniswap') {
    return await uniswapLiquidationStrategy(
      fuse,
      borrower,
      liquidationAmount,
      exchangeToTokenAddress,
      outputPrice,
      outputDecimals,
      strategyAndData
    );
  } else throw 'Invalid liquidation strategy';
}
