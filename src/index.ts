import { ERC20Abi, Fuse, SupportedChains } from '@midas-capital/sdk';
import { JsonRpcProvider, TransactionRequest, TransactionResponse } from '@ethersproject/providers';
import { BigNumber, constants, Contract, utils } from 'ethers';
import {
  FusePoolUser,
  NATIVE_TOKEN_DATA,
  Pool,
  SCALE_FACTOR_ONE_18_WEI,
  SCALE_FACTOR_UNDERLYING_DECIMALS,
} from './utils';
import dotenv from 'dotenv';
dotenv.config();

const chainId: number = process.env.TARGET_CHAIN_ID
  ? parseInt(process.env.TARGET_CHAIN_ID)
  : SupportedChains.ganache;
const web3 = new JsonRpcProvider(process.env.WEB3_HTTP_PROVIDER_URL);
const fuse = new Fuse(web3, chainId);

async function approveTokensToSafeLiquidator(erc20Address: string) {
  // Build data
  const signer = await fuse.provider.getSigner(process.env.ETHEREUM_ADMIN_ACCOUNT);
  let token = new Contract(erc20Address, ERC20Abi, signer);

  token = await token.connect(signer);
  const txCount = await fuse.provider.getTransactionCount(process.env.ETHEREUM_ADMIN_ACCOUNT!);

  let data = token.interface.encodeFunctionData('approve', [
    fuse.contracts.FuseSafeLiquidator.address,
    constants.MaxUint256,
  ]);

  // Build transaction
  const tx = {
    from: process.env.ETHEREUM_ADMIN_ACCOUNT,
    to: erc20Address,
    value: BigNumber.from(0),
    data: data,
    nonce: txCount,
  };
  const gasLimit = await fetchGasLimitForTransaction('approve', tx);
  const txRequest: TransactionRequest = {
    ...tx,
    gasLimit: gasLimit,
  };

  if (process.env.NODE_ENV !== 'production')
    console.log('Signing and sending approval transaction for: ' + erc20Address);

  // send transaction
  let sentTx: TransactionResponse;
  try {
    sentTx = await signer.sendTransaction(txRequest);
    await sentTx.wait();
  } catch (error) {
    throw 'Error sending ' + erc20Address + ' approval transaction: ' + error;
  }
  console.log('Successfully sent approval transaction for: ' + erc20Address);
  return sentTx;
}

async function fetchGasLimitForTransaction(method: string, tx: TransactionRequest) {
  try {
    return await fuse.provider.estimateGas(tx);
  } catch (error) {
    throw `Failed to estimate gas before signing and sending ${method} transaction: ${error}`;
  }
}

async function sendTransactionToSafeLiquidator(
  method: string,
  params: Array<any>,
  value: number | BigNumber
) {
  // Build data
  let data = fuse.contracts.FuseSafeLiquidator.interface.encodeFunctionData(method, params);
  const txCount = await fuse.provider.getTransactionCount(process.env.ETHEREUM_ADMIN_ACCOUNT!);
  const signer = await fuse.provider.getSigner(process.env.ETHEREUM_ADMIN_ACCOUNT);

  // Build transaction
  const tx = {
    from: process.env.ETHEREUM_ADMIN_ACCOUNT,
    to: fuse.contracts.FuseSafeLiquidator.address,
    value: value,
    data: data,
    nonce: txCount,
  };
  // Estimate gas for transaction
  const gasLimit = await fetchGasLimitForTransaction(method, tx);
  const txRequest: TransactionRequest = {
    ...tx,
    gasLimit: gasLimit,
  };

  if (process.env.NODE_ENV !== 'production')
    console.log('Signing and sending', method, 'transaction:', tx);

  let sentTx;
  // Sign transaction
  // Send transaction
  try {
    sentTx = await signer.sendTransaction(txRequest);
  } catch (error) {
    throw `Error sending ${method}, transaction: ${error}`;
  }
  console.log('Successfully sent', method, 'transaction hash:', sentTx.hash);
  return sentTx;
}

async function liquidateUnhealthyBorrows() {
  const liquidations = await getPotentialLiquidations();
  for (const comptroller of Object.keys(liquidations)) {
    for (const liquidation of liquidations[comptroller]!) {
      try {
        await sendTransactionToSafeLiquidator(liquidation[0], liquidation[1], liquidation[2]);
      } catch (error) {
        throw 'Error sending sendTransactionToSafeLiquidator transaction: ' + error;
      }
    }
  }
}

async function gatherLiquidations(
  comptrollers: Array<string>,
  users: Array<Array<FusePoolUser>>,
  closeFactors: Array<BigNumber>,
  liquidationIncentives: Array<BigNumber>,
  pools: Pool
) {
  for (let i = 0; i < comptrollers.length; i++) {
    users[i].slice().sort((a, b) => b.totalBorrow - a.totalBorrow);
    const liquidations = [];

    for (let j = 0; j < users[i].length; j++) {
      console.log('gatherLiquidations', ' for user: ', j, 'comptroller: ', i);
      const liquidation = await getPotentialLiquidation(
        users[i][j],
        closeFactors[i],
        liquidationIncentives[i]
      );
      if (liquidation !== null) liquidations.push(liquidation);
    }
    if (liquidations.length > 0) {
      pools[comptrollers[i]] = liquidations;
    }
  }
  return pools;
}

async function getPotentialLiquidations(): Promise<Pool> {
  let pools: Pool = {};

  let comptrollers;
  let data;
  let users;
  let closeFactors;
  let liquidationIncentives;
  // Get potential liquidations from public pools
  if (process.env.SUPPORT_ALL_PUBLIC_POOLS) {
    data = await fuse.contracts.FusePoolLens.callStatic.getPublicPoolUsersWithData(
      utils.parseEther('1')
    );
    comptrollers = data['0'] as Array<string>;
    users = data['1'] as Array<Array<FusePoolUser>>;
    closeFactors = data['2'] as Array<BigNumber>;
    liquidationIncentives = data['3'] as Array<BigNumber>;
    pools = await gatherLiquidations(
      comptrollers,
      users,
      closeFactors,
      liquidationIncentives,
      pools
    );
  }

  // Get potential liquidations from supported pools (excluding the public pools that have already been checked)
  if (process.env.SUPPORTED_POOL_COMPTROLLERS!.length > 0) {
    comptrollers = [];
    const potentialComptrollers = process.env.SUPPORTED_POOL_COMPTROLLERS!.split(',');
    for (const comptroller of potentialComptrollers) {
      if (!pools[comptroller]) {
        comptrollers.push(comptroller);
      }
    }

    data = await fuse.contracts.FusePoolLens.callStatic.getPoolUsersWithData(
      comptrollers,
      utils.parseEther('1')
    );
    users = data['0'];
    closeFactors = data['1'];
    liquidationIncentives = data['2'];
    pools = await gatherLiquidations(
      comptrollers,
      users,
      closeFactors,
      liquidationIncentives,
      pools
    );
  }

  return pools;
}

async function getPotentialLiquidation(
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
        `Gathered transaction data for safeLiquidate a ${NATIVE_TOKEN_DATA[chainId].symbol} borrow:
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

// Liquidate unhealthy borrows and repeat every LIQUIDATION_INTERVAL_SECONDS
async function liquidateAndRepeat() {
  await liquidateUnhealthyBorrows();
  setTimeout(liquidateAndRepeat, parseInt(process.env.LIQUIDATION_INTERVAL_SECONDS || '5') * 1000);
}

(async function () {
  if (process.env.LIQUIDATION_STRATEGY === '') {
    for (const tokenAddress of process.env.SUPPORTED_OUTPUT_CURRENCIES!.split(',')) {
      await approveTokensToSafeLiquidator(tokenAddress);
    }
  }
  liquidateAndRepeat();
})();
