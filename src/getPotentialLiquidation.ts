import {
  FusePoolUser,
  NATIVE_TOKEN_DATA,
  SCALE_FACTOR_ONE_18_WEI,
  SCALE_FACTOR_UNDERLYING_DECIMALS,
} from './utils';
import { BigNumber, constants, utils } from 'ethers';
import { Fuse } from '@midas-capital/sdk';

export default async function getPotentialLiquidation(
  fuse: Fuse,
  borrower: FusePoolUser,
  closeFactor: BigNumber,
  liquidationIncentive: BigNumber
): Promise<[string, Array<any>, number | BigNumber] | null> {
  // Get debt and collateral
  borrower = { ...borrower };
  borrower.debt = [];
  borrower.collateral = [];

  for (let asset of borrower.assets) {
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
    process.env.SUPPORTED_INPUT_CURRENCIES!.split(',').indexOf(borrower.debt[0].underlyingToken) >=
      0
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
  let expectedGasAmount;

  // Depending on liquidation strategy
  if (process.env.LIQUIDATION_STRATEGY === '') {
    // Estimate gas usage
    try {
      if (borrower.debt[0].underlyingToken === constants.AddressZero) {
        expectedGasAmount = await fuse.contracts.FuseSafeLiquidator.estimateGas.safeLiquidate(
          borrower.account,
          borrower.debt[0].cToken,
          borrower.collateral[0].cToken,
          0,
          exchangeToTokenAddress,
          {
            gas: 1e9,
            value: liquidationAmount,
            from: process.env.ETHEREUM_ADMIN_ACCOUNT,
          }
        );
      } else {
        expectedGasAmount = await fuse.contracts.FuseSafeLiquidator.estimateGas.safeLiquidate(
          borrower.account,
          liquidationAmount,
          borrower.debt[0].cToken,
          borrower.collateral[0].cToken,
          0,
          exchangeToTokenAddress,
          {
            gas: 1e9,
            from: process.env.ETHEREUM_ADMIN_ACCOUNT,
          }
        );
      }
    } catch {
      expectedGasAmount = 600000;
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
      console.log(
        `Gathered transaction data for safeLiquidate a ${
          NATIVE_TOKEN_DATA[fuse.chainId].symbol
        } borrow:
         - Liquidation Amount: ${utils.formatEther(liquidationAmount)}
         - Underlying Collateral Token: ${borrower.collateral[0].underlyingSymbol}
         - Underlying Debt Token: ${borrower.debt[0].underlyingSymbol}
         - Exchanging liquidated tokens to: ${exchangeToTokenAddress}
         `
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
          [],
          [],
        ],
        liquidationAmount,
      ];
    } else {
      console.log(
        `Gathered transaction data for safeLiquidate a ${borrower.debt[0].underlyingSymbol} borrow:
         - Liquidation Amount: ${utils.formatEther(liquidationAmount)}
         - Underlying Collateral Token: ${borrower.collateral[0].underlyingSymbol}
         - Underlying Debt Token: ${borrower.debt[0].underlyingSymbol}
         - Exchanging liquidated tokens to: ${exchangeToTokenAddress}
         `
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
          [],
          [],
        ],
        0,
      ];
    }
  } else if (process.env.LIQUIDATION_STRATEGY === 'uniswap') {
    // Estimate gas usage
    try {
      if (borrower.debt[0].underlyingToken === constants.AddressZero) {
        expectedGasAmount =
          await fuse.contracts.FuseSafeLiquidator.estimateGas.safeLiquidateToEthWithFlashLoan(
            borrower.account,
            liquidationAmount,
            borrower.debt[0].cToken,
            borrower.collateral[0].cToken,
            0,
            exchangeToTokenAddress,
            {
              gas: 1e9,
              from: process.env.ETHEREUM_ADMIN_ACCOUNT,
            }
          );
      } else {
        expectedGasAmount =
          await fuse.contracts.FuseSafeLiquidator.safeLiquidateToTokensWithFlashLoan(
            borrower.account,
            liquidationAmount,
            borrower.debt[0].cToken,
            borrower.collateral[0].cToken,
            0,
            exchangeToTokenAddress,
            {
              gas: 1e9,
              from: process.env.ETHEREUM_ADMIN_ACCOUNT,
            }
          );
      }
    } catch {
      expectedGasAmount = 750000;
    }

    // Get gas fee
    const gasPrice = await fuse.provider.getGasPrice();
    const expectedGasFee = gasPrice.mul(expectedGasAmount);

    // Get min profit
    const minOutputEth = BigNumber.from(process.env.MINIMUM_PROFIT_NATIVE).add(expectedGasFee);
    const minProfitAmountScaled = minOutputEth
      .div(outputPrice)
      .mul(BigNumber.from(10).pow(outputDecimals))
      .toString();

    // Return transaction
    if (borrower.debt[0].underlyingToken === constants.AddressZero) {
      return [
        'safeLiquidateToEthWithFlashLoan',
        [
          borrower.account,
          liquidationAmount,
          borrower.debt[0].cToken,
          borrower.collateral[0].cToken,
          minProfitAmountScaled,
          exchangeToTokenAddress,
        ],
        0,
      ];
    } else {
      return [
        'safeLiquidateToTokensWithFlashLoan',
        [
          borrower.account,
          liquidationAmount,
          borrower.debt[0].cToken,
          borrower.collateral[0].cToken,
          minProfitAmountScaled,
          exchangeToTokenAddress,
        ],
        0,
      ];
    }
  } else throw 'Invalid liquidation strategy';
}
