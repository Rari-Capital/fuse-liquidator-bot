const Big = require("big.js");

const getPotentialLiquidation = async (borrower, closeFactor, liquidationIncentive) => {
    var closeFactor = (new Big(closeFactor)).div(1e18);
    var liquidationIncentive = (new Big(liquidationIncentive)).div(1e18);

    // Get debt and collateral
    borrower = { ...borrower };
    borrower.debt = [];
    borrower.collateral = [];

    for (var asset of borrower.assets) {
        asset = { ...asset };
        asset.borrowBalanceEth = new Big(asset.borrowBalance).mul(asset.underlyingPrice).div(1e36);
        asset.supplyBalanceEth = new Big(asset.supplyBalance).mul(asset.underlyingPrice).div(1e36);
        if (parseInt(asset.borrowBalance) > 0) borrower.debt.push(asset);
        if (asset.membership && parseInt(asset.supplyBalance) > 0) borrower.collateral.push(asset);
    }

    // Sort debt and collateral from highest to lowest
    borrower.debt.sort((a, b) => b.borrowBalanceEth.gt(a.borrowBalanceEth));
    borrower.collateral.sort((a, b) => b.supplyBalanceEth.gt(a.supplyBalanceEth));

    // Check SUPPORTED_INPUT_CURRENCIES (if LIQUIDATION_STRATEGY === "")
    if (process.env.LIQUIDATION_STRATEGY === "" && process.env.SUPPORTED_INPUT_CURRENCIES.split(',').indexOf(borrower.debt[0].underlyingSymbol === "ETH" ? "ETH" : borrower.debt[0].underlyingToken) >= 0) return null;

    // Check SUPPORTED_OUTPUT_CURRENCIES: replace EXCHANGE_TO_TOKEN_ADDRESS with underlying collateral if underlying collateral is in SUPPORTED_OUTPUT_CURRENCIES
    var exchangeToTokenAddress = process.env.EXCHANGE_TO_TOKEN_ADDRESS;
    if (process.env.EXCHANGE_TO_TOKEN_ADDRESS === "" || process.env.SUPPORTED_OUTPUT_CURRENCIES.split(',').indexOf(borrower.collateral[0].underlyingSymbol === "ETH" ? "ETH" : borrower.collateral[0].underlyingToken) >= 0) exchangeToTokenAddress = borrower.collateral[0].underlyingSymbol === "ETH" ? "ETH" : borrower.collateral[0].underlyingToken;

    // Get exchangeToTokenAddress price and decimals
    var [outputPrice, outputDecimals] = await getCurrencyEthPriceAndDecimals(exchangeToTokenAddress);

    // exchangeToTokenAddress to 0x0000000000000000000000000000000000000000 if ETH
    if (exchangeToTokenAddress === "ETH") exchangeToTokenAddress = "0x0000000000000000000000000000000000000000";

    // Get liquidation amount
    borrower.maxLiquidationValue = new Big(borrower.totalBorrow).mul(closeFactor).div(1e18);
    const underlyingDebtPrice = (new Big(borrower.debt[0].underlyingPrice)).div((new Big(10)).pow(36 - borrower.debt[0].underlyingDecimals));
    const liquidationAmount = borrower.maxLiquidationValue.div(underlyingDebtPrice);
    var liquidationAmountScaled = liquidationAmount.mul((new Big(10)).pow(parseInt(borrower.debt[0].underlyingDecimals))).toFixed(0);

    // const seizeAmountEth = borrower.maxLiquidationValue.mul(liquidationIncentive);
    // const underlyingCollateralPrice = (new Big(borrower.collateral[0].underlyingPrice)).div((new Big(10)).pow(36 - borrower.collateral[0].underlyingDecimals));
    // const seizeAmount = seizeAmountEth.div(underlyingCollateralPrice);

    // const expectedCollateral = seizeAmountEth;
    // const actualCollateral = (new Big(borrower.collateral[0].supplyBalance)).mul(borrower.collateral[0].underlyingPrice).div(1e36);
    
    // TODO: Is this necessary / is it working?
    // if (expectedCollateral.gt(actualCollateral)) return null;
    
    if (process.env.LIQUIDATION_STRATEGY === "") {
        // * Estimate gas usage
        var expectedGasAmount;
        try {
            if (borrower.debt[0].underlyingSymbol === 'ETH') {
                expectedGasAmount = await fuseSafeLiquidator.methods.safeLiquidate(borrower.account, borrower.debt[0].cToken, borrower.collateral[0].cToken, 0, exchangeToTokenAddress).estimateGas({ gas: 1e9, value: liquidationAmountScaled, from: process.env.ETHEREUM_ADMIN_ACCOUNT });
            } else {
                expectedGasAmount = await fuseSafeLiquidator.methods.safeLiquidate(borrower.account, liquidationAmountScaled, borrower.debt[0].cToken, borrower.collateral[0].cToken, 0, exchangeToTokenAddress).estimateGas({ gas: 1e9, from: process.env.ETHEREUM_ADMIN_ACCOUNT });
            }
        } catch {
            expectedGasAmount = 750000;
        }

        // Get gas fee
        const gasPrice = new Big(await web3.eth.getGasPrice()).div(1e18);
        const expectedGasFee = gasPrice.mul(expectedGasAmount);

        // Get min seize
        var liquidationAmountEth = liquidationAmount.mul(underlyingDebtPrice);
        var minEthSeizeAmountBreakEven = expectedGasFee.add(liquidationAmountEth);
        var minEthSeizeAmount = minEthSeizeAmountBreakEven.add(process.env.MINIMUM_PROFIT);
        var minSeizeAmount = minEthSeizeAmount.div(outputPrice);
        var minSeizeAmountScaled = minSeizeAmount.mul((new Big(10)).pow(outputDecimals)).toFixed(0);

        // TODO: Check expected seize against minSeizeAmount

        // Return transaction
        if (borrower.debt[0].underlyingSymbol === 'ETH') {
            return ["safeLiquidate", [borrower.account, borrower.debt[0].cToken, borrower.collateral[0].cToken, minSeizeAmountScaled, exchangeToTokenAddress], liquidationAmountScaled];
        } else {
            // TODO: Token approval
            return ["safeLiquidate", [borrower.account, liquidationAmountScaled, borrower.debt[0].cToken, borrower.collateral[0].cToken, minSeizeAmountScaled, exchangeToTokenAddress], 0];
        }
    } else if (process.env.LIQUIDATION_STRATEGY === "uniswap") {
        // Estimate gas usage
        try {
            if (borrower.debt[0].underlyingSymbol === 'ETH') {
                var expectedGasAmount = await fuseSafeLiquidator.methods.safeLiquidateToEthWithFlashLoan(borrower.account, liquidationAmount.mul((new Big(10)).pow(borrower.debt[0].underlyingDecimals)).toFixed(0), borrower.debt[0].cToken, borrower.collateral[0].cToken, 0, exchangeToTokenAddress).estimateGas({ gas: 1e9, value: liquidationAmountScaled, from: process.env.ETHEREUM_ADMIN_ACCOUNT });
            } else {
                var expectedGasAmount = await fuseSafeLiquidator.methods.safeLiquidateToTokensWithFlashLoan(borrower.account, liquidationAmountScaled, borrower.debt[0].cToken, borrower.collateral[0].cToken, 0, exchangeToTokenAddress).estimateGas({ gas: 1e9, from: process.env.ETHEREUM_ADMIN_ACCOUNT });
            }
        } catch {
            expectedGasAmount = 600000;
        }

        // Get gas fee
        const gasPrice = new Big(await web3.eth.getGasPrice()).div(1e18);
        const expectedGasFee = gasPrice.mul(expectedGasAmount);

        // Get min profit
        var minOutputEth = (new Big(process.env.MINIMUM_PROFIT_ETH)).add(expectedGasFee);
        var minProfitAmountScaled = minOutputEth.div(outputPrice).mul((new Big(10)).pow(outputDecimals)).toFixed(0);

        // TODO: Check expected profit against minProfitAmount

        // Return transaction
        if (borrower.debt[0].underlyingSymbol === 'ETH') {
            return ["safeLiquidateToEthWithFlashLoan", [borrower.account, liquidationAmount.mul((new Big(10)).pow(borrower.debt[0].underlyingDecimals)).toFixed(0), borrower.debt[0].cToken, borrower.collateral[0].cToken, minProfitAmountScaled, exchangeToTokenAddress], liquidationAmountScaled];
        } else {
            return ["safeLiquidateToTokensWithFlashLoan", [borrower.account, liquidationAmountScaled, borrower.debt[0].cToken, borrower.collateral[0].cToken, minProfitAmountScaled, exchangeToTokenAddress], 0];
        }
    } else throw "Invalid liquidation strategy";
}

export default getPotentialLiquidation;