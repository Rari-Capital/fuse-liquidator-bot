import axios from "axios";
import {ERC20Abi, Fuse, FuseAsset, SupportedChains} from "@midas-capital/sdk"
import {JsonRpcProvider, TransactionRequest, TransactionResponse} from '@ethersproject/providers';
import {BigNumber, constants, Contract, utils} from "ethers";


// Set Big.js rounding mode to round down

const web3 = new JsonRpcProvider(process.env.WEB3_HTTP_PROVIDER_URL)
const fuse = new Fuse(web3, SupportedChains.ganache)


async function approveTokensToSafeLiquidator(erc20Address: string) {
    // Build data
    const signer = await fuse.provider.getSigner(process.env.ETHEREUM_ADMIN_ACCOUNT)
    let token = new Contract(erc20Address, ERC20Abi, signer);

    token = await token.connect(signer)
    const txCount = await fuse.provider.getTransactionCount(process.env.ETHEREUM_ADMIN_ACCOUNT!)

    let data = token.interface.encodeFunctionData("approve", [fuse.contracts.FuseSafeLiquidator.address, constants.MaxUint256]);

    // Build transaction
    const tx = {
        from: process.env.ETHEREUM_ADMIN_ACCOUNT,
        to: erc20Address,
        value: BigNumber.from(0),
        data: data,
        nonce: txCount
    };
    const gasLimit = await fetchGasLimitForTransaction("approve", tx)
    const txRequest: TransactionRequest = {
        ...tx,
        gasLimit: gasLimit
    }

    if (process.env.NODE_ENV !== "production") console.log("Signing and sending " + erc20Address + " approval transaction:", txRequest);

    // send transaction
    let sentTx: TransactionResponse;
    try {
        sentTx = await signer.sendTransaction(txRequest);
        await sentTx.wait()
    } catch (error) {
        throw "Error sending " + erc20Address + " approval transaction: " + error;
    }
    console.log("Successfully sent " + erc20Address + " approval transaction:", sentTx);
    return sentTx;
}

async function fetchGasLimitForTransaction(method: string, tx: TransactionRequest) {
    try {
        return await fuse.provider.estimateGas(tx);
    } catch (error) {
        throw `Failed to estimate gas before signing and sending ${method} transaction: ${error}`;
    }
}

async function sendTransactionToSafeLiquidator(method: string, params: Array<any>, value: number | BigNumber) {
    // Build data
    let data = fuse.contracts.FuseSafeLiquidator.interface.encodeFunctionData(method, params);
    const txCount = await fuse.provider.getTransactionCount(process.env.ETHEREUM_ADMIN_ACCOUNT!)
    const signer = await fuse.provider.getSigner(process.env.ETHEREUM_ADMIN_ACCOUNT)

    // Build transaction
    const tx = {
        from: process.env.ETHEREUM_ADMIN_ACCOUNT,
        to: fuse.contracts.FuseSafeLiquidator.address,
        value: value,
        data: data,
        nonce: txCount
    };
    // Estimate gas for transaction
    const gasLimit = await fetchGasLimitForTransaction(method, tx)
    const txRequest: TransactionRequest = {
        ...tx,
        gasLimit: gasLimit
    }

    if (process.env.NODE_ENV !== "production") console.log("Signing and sending", method, "transaction:", tx);

    console.log(tx, "TRRERFEDSC")

    let sentTx;
    // Sign transaction
    // Send transaction
    try {
        sentTx = await signer.sendTransaction(txRequest);
    } catch (error) {
        throw `Error sending ${method}, transaction: ${error}`;
    }
    console.log("Successfully sent", method, "transaction:", sentTx);
    return sentTx;
}

async function liquidateUnhealthyBorrows() {
    const liquidations = await getPotentialLiquidations();

    for (const comptroller of Object.keys(liquidations)) {
        for (const liquidation of liquidations[comptroller]!) {
            try {
                await sendTransactionToSafeLiquidator(liquidation[0], liquidation[1], liquidation[2]);
            } catch (error) {
                throw "Error sending sendTransactionToSafeLiquidator transaction: " + error;
            }
        }
    }
}

async function gatherLiquidations(comptrollers: Array<string>, users: Array<Array<FusePoolUser>>, closeFactors: Array<BigNumber>, liquidationIncentives: Array<BigNumber>, pools: Pool) {
    for (let i = 0; i < comptrollers.length; i++) {
        users[i].slice().sort((a, b) => b.totalBorrow - a.totalBorrow);
        const liquidations = [];

        for (let j = 0; j < users[i].length; j++) {
            console.log("gatherLiquidations", " for user: ", j, "comptroller: ", i)
            const liquidation = await getPotentialLiquidation(users[i][j], closeFactors[i], liquidationIncentives[i]);
            if (liquidation !== null) liquidations.push(liquidation);
        }
        if (liquidations.length > 0) {
            pools[comptrollers[i]] = liquidations
        }
    }
    return pools
}

type ExtendedFuseAsset = FuseAsset & {
    borrowBalanceEth: BigNumber;
    supplyBalanceEth: BigNumber;
}

type FusePoolUser = {
    account: string;
    totalBorrow: number;
    totalCollateral: number;
    health: number;
    debt: Array<ExtendedFuseAsset>;
    collateral: Array<ExtendedFuseAsset>;
    assets: Array<ExtendedFuseAsset>;
}

type Pool = {
    [comptrollerAddress: string]: Array<[string, Array<any>, number | BigNumber]> | null
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
        data = await fuse.contracts.FusePoolLens.callStatic.getPublicPoolUsersWithData(utils.parseEther("1"))
        comptrollers = data["0"] as Array<string>;
        users = data["1"] as Array<Array<FusePoolUser>>;
        closeFactors = data["2"] as Array<BigNumber>;
        liquidationIncentives = data["3"] as Array<BigNumber>;
        pools = await gatherLiquidations(comptrollers, users, closeFactors, liquidationIncentives, pools)

    }

    // Get potential liquidations from supported pools (excluding the public pools that have already been checked)
    if (process.env.SUPPORTED_POOL_COMPTROLLERS!.length > 0) {
        comptrollers = [];
        const potentialComptrollers = process.env.SUPPORTED_POOL_COMPTROLLERS!.split(",");
        for (const comptroller of potentialComptrollers) {
            if (!pools[comptroller]) {
                comptrollers.push(comptroller)
            }
        }

        data = await fuse.contracts.FusePoolLens.callStatic.getPoolUsersWithData(comptrollers, utils.parseEther("1"))
        users = data["0"];
        closeFactors = data["1"];
        liquidationIncentives = data["2"];
        pools = await gatherLiquidations(comptrollers, users, closeFactors, liquidationIncentives, pools)
    }

    return pools;
}

async function getPotentialLiquidation(borrower: FusePoolUser, closeFactor: BigNumber, liquidationIncentive: BigNumber): Promise<[string, Array<any>, number | BigNumber] | null> {
    // Get debt and collateral
    borrower = {...borrower};
    borrower.debt = [];
    borrower.collateral = [];

    for (let asset of borrower.assets) {
        asset = {...asset};
        asset.borrowBalanceEth = asset.borrowBalance.mul(asset.underlyingPrice).div(BigNumber.from(10).pow(36));
        asset.supplyBalanceEth = asset.supplyBalance.mul(asset.underlyingPrice).div(BigNumber.from(10).pow(36));
        if (asset.borrowBalance.gt(0)) borrower.debt.push(asset);
        if (asset.membership && asset.supplyBalance.gt(0)) borrower.collateral.push(asset);
    }


    // Sort debt and collateral from highest to lowest ETH value
    borrower.debt.sort((a, b) => b.borrowBalanceEth.gt(a.borrowBalanceEth) ? 1 : -1);
    borrower.collateral.sort((a, b) => b.supplyBalanceEth.gt(a.supplyBalanceEth) ? 1 : -1);

    // Check SUPPORTED_INPUT_CURRENCIES (if LIQUIDATION_STRATEGY === "")
    if (process.env.LIQUIDATION_STRATEGY === "" && process.env.SUPPORTED_INPUT_CURRENCIES!.split(',').indexOf(borrower.debt[0].underlyingSymbol === "ETH" ? "ETH" : borrower.debt[0].underlyingToken) >= 0) return null;

    // Check SUPPORTED_OUTPUT_CURRENCIES: replace EXCHANGE_TO_TOKEN_ADDRESS with underlying collateral if underlying collateral is in SUPPORTED_OUTPUT_CURRENCIES
    let exchangeToTokenAddress = process.env.EXCHANGE_TO_TOKEN_ADDRESS!;
    if (process.env.EXCHANGE_TO_TOKEN_ADDRESS === "" || process.env.SUPPORTED_OUTPUT_CURRENCIES!.split(',').indexOf(borrower.collateral[0].underlyingSymbol === "ETH" ? "ETH" : borrower.collateral[0].underlyingToken) >= 0) exchangeToTokenAddress = borrower.collateral[0].underlyingSymbol === "ETH" ? "ETH" : borrower.collateral[0].underlyingToken;

    // Get exchangeToTokenAddress price and decimals
    let [outputPrice, outputDecimals] = await getCurrencyEthPriceAndDecimals(exchangeToTokenAddress);

    // exchangeToTokenAddress to 0x0000000000000000000000000000000000000000 if ETH
    if (exchangeToTokenAddress === "ETH") exchangeToTokenAddress = "0x0000000000000000000000000000000000000000";

    // Get debt and collateral prices
    const underlyingDebtPrice = borrower.debt[0].underlyingPrice.div(BigNumber.from(10).pow(36 - borrower.debt[0].underlyingDecimals.toNumber()));
    const underlyingCollateralPrice = borrower.collateral[0].underlyingPrice.div(BigNumber.from(10).pow(36 - borrower.collateral[0].underlyingDecimals.toNumber()));

    // Get liquidation amount
    let liquidationAmountScaled = borrower.debt[0].borrowBalance.mul(closeFactor).div(BigNumber.from(10).pow(18));
    let liquidationAmount = liquidationAmountScaled.div(BigNumber.from(10).pow(borrower.debt[0].underlyingDecimals.toNumber()));
    let liquidationValueEth = liquidationAmount.mul(underlyingDebtPrice);
    // Get seize amount
    let seizeAmountEth = liquidationValueEth.mul(liquidationIncentive).div(BigNumber.from(10).pow(18));
    let seizeAmount = seizeAmountEth.div(underlyingCollateralPrice);

    // Check if actual collateral is too low to seize seizeAmount; if so, recalculate liquidation amount
    const actualCollateral = borrower.collateral[0].supplyBalance.div(BigNumber.from(10).pow(borrower.collateral[0].underlyingDecimals.toNumber()));
    if (seizeAmount.gt(actualCollateral)) {
        seizeAmount = actualCollateral;
        seizeAmountEth = seizeAmount.mul(underlyingCollateralPrice);
        liquidationValueEth = seizeAmountEth.div(liquidationIncentive).div(BigNumber.from(10).pow(18));
        liquidationAmount = liquidationValueEth.div(underlyingDebtPrice);
        liquidationAmountScaled = liquidationAmount.mul(BigNumber.from(10).pow(borrower.debt[0].underlyingDecimals.toNumber()));
    }

    // Convert liquidationAmountScaled to string
    let expectedGasAmount;

    // Depending on liquidation strategy
    if (process.env.LIQUIDATION_STRATEGY === "") {
        // Estimate gas usage
        try {
            if (borrower.debt[0].underlyingSymbol === 'ETH') {
                expectedGasAmount = await fuse.contracts.FuseSafeLiquidator.estimateGas.safeLiquidate(borrower.account, borrower.debt[0].cToken, borrower.collateral[0].cToken, 0, exchangeToTokenAddress, {
                    gas: 1e9,
                    value: liquidationAmountScaled,
                    from: process.env.ETHEREUM_ADMIN_ACCOUNT
                });
            } else {
                expectedGasAmount = await fuse.contracts.FuseSafeLiquidator.estimateGas.safeLiquidate(borrower.account, liquidationAmountScaled, borrower.debt[0].cToken, borrower.collateral[0].cToken, 0, exchangeToTokenAddress, {
                    gas: 1e9,
                    from: process.env.ETHEREUM_ADMIN_ACCOUNT
                });
            }
        } catch {
            expectedGasAmount = 600000;
        }

        // Get gas fee
        const gasPrice = BigNumber.from(await fuse.provider.getGasPrice()).div(BigNumber.from(10).pow(18));
        const expectedGasFee = gasPrice.mul(expectedGasAmount);

        // Get min seize
        const minEthSeizeAmountBreakEven = expectedGasFee.add(liquidationValueEth);
        console.log(minEthSeizeAmountBreakEven.toString(), process.env.MINIMUM_PROFIT_ETH)

        const minEthSeizeAmount = minEthSeizeAmountBreakEven.add(BigNumber.from(process.env.MINIMUM_PROFIT_ETH));
        const minSeizeAmount = minEthSeizeAmount.div(outputPrice);
        const minSeizeAmountScaled = minSeizeAmount.mul((BigNumber.from(10)).pow(outputDecimals)).toString();

        // Check expected seize against minSeizeAmount
        if (seizeAmount.lt(minSeizeAmount)) return null;

        // Return transaction
        if (borrower.debt[0].underlyingSymbol === 'ETH') {
            return ["safeLiquidate(address,uint256,address,address,uint256,address,address,address[],bytes[])", [borrower.account, minSeizeAmountScaled, borrower.debt[0].cToken, borrower.collateral[0].cToken, 0, borrower.collateral[0].cToken, exchangeToTokenAddress, [], []], liquidationAmountScaled];
        } else {
            return ["safeLiquidate(address,uint256,address,address,uint256,address,address,address[],bytes[])", [borrower.account, liquidationAmountScaled, borrower.debt[0].cToken, borrower.collateral[0].cToken, minSeizeAmountScaled, borrower.collateral[0].cToken, exchangeToTokenAddress, [], []], 0];
        }
    } else if (process.env.LIQUIDATION_STRATEGY === "uniswap") {
        // Estimate gas usage
        try {
            if (borrower.debt[0].underlyingSymbol === 'ETH') {
                expectedGasAmount = await fuse.contracts.FuseSafeLiquidator.estimateGas.safeLiquidateToEthWithFlashLoan(borrower.account, liquidationAmountScaled, borrower.debt[0].cToken, borrower.collateral[0].cToken, 0, exchangeToTokenAddress, {
                    gas: 1e9,
                    from: process.env.ETHEREUM_ADMIN_ACCOUNT
                });
            } else {
                expectedGasAmount = await fuse.contracts.FuseSafeLiquidator.safeLiquidateToTokensWithFlashLoan(borrower.account, liquidationAmountScaled, borrower.debt[0].cToken, borrower.collateral[0].cToken, 0, exchangeToTokenAddress, {
                    gas: 1e9,
                    from: process.env.ETHEREUM_ADMIN_ACCOUNT
                });
            }
        } catch {
            expectedGasAmount = 750000;
        }

        // Get gas fee
        const gasPrice = BigNumber.from(await fuse.provider.getGasPrice()).div(1e18);
        const expectedGasFee = gasPrice.mul(expectedGasAmount);

        // Get min profit
        const minOutputEth = (BigNumber.from(process.env.MINIMUM_PROFIT_ETH)).add(expectedGasFee);
        const minProfitAmountScaled = minOutputEth.div(outputPrice).mul((BigNumber.from(10)).pow(outputDecimals)).toString();

        // Return transaction
        if (borrower.debt[0].underlyingSymbol === 'ETH') {
            return ["safeLiquidateToEthWithFlashLoan", [borrower.account, liquidationAmountScaled.toString(), borrower.debt[0].cToken, borrower.collateral[0].cToken, minProfitAmountScaled, exchangeToTokenAddress], 0];
        } else {
            return ["safeLiquidateToTokensWithFlashLoan", [borrower.account, liquidationAmountScaled.toString(), borrower.debt[0].cToken, borrower.collateral[0].cToken, minProfitAmountScaled, exchangeToTokenAddress], 0];
        }
    } else throw "Invalid liquidation strategy";
}

async function getPrice(tokenAddress: string) {
    tokenAddress = tokenAddress.toLowerCase();

    // Get ETH-based price of an ERC20 via CoinGecko
    const decoded = (await axios.get('https://api.coingecko.com/api/v3/simple/token_price/ethereum', {
        params: {
            vs_currencies: "eth",
            contract_addresses: tokenAddress
        }
    })).data;
    if (!decoded || !decoded[tokenAddress]) throw "Failed to decode price of " + tokenAddress + " from CoinGecko";
    return decoded[tokenAddress].eth;
}

type PriceCache = {
    [tokenAddress: string]: {
        lastUpdated: number,
        value: number
    }
};

type DecimalsCache = {
    [tokenAddress: string]: number,
};

const currencyDecimalsCache: DecimalsCache = {};
const currencyPriceCache: PriceCache = {};

async function getCurrencyEthPriceAndDecimals(tokenAddressOrEth: string) {
    const epochNow = (new Date()).getTime() / 1000;
    // Quick return for ETH
    if (tokenAddressOrEth === "ETH") return [1, 18];

    // Lowercase token address
    tokenAddressOrEth = tokenAddressOrEth.toLowerCase();

    // Get price (from cache if possible)
    if (currencyPriceCache[tokenAddressOrEth] === undefined || currencyPriceCache[tokenAddressOrEth].lastUpdated < (epochNow - (60 * 15))) {
        currencyPriceCache[tokenAddressOrEth] = {
            lastUpdated: epochNow,
            value: await getPrice(tokenAddressOrEth)
        };
    }

    // Get decimals (from cache if possible)
    if (currencyDecimalsCache[tokenAddressOrEth] === undefined) {
        currencyDecimalsCache[tokenAddressOrEth] = tokenAddressOrEth === "ETH" ? 18 : parseInt(await (new Contract(tokenAddressOrEth, ERC20Abi, fuse.provider)).decimals());
    }


    return [currencyPriceCache[tokenAddressOrEth].value, currencyDecimalsCache[tokenAddressOrEth]];
}

// Liquidate unhealthy borrows and repeat every LIQUIDATION_INTERVAL_SECONDS
async function liquidateAndRepeat() {
    await liquidateUnhealthyBorrows();
    setTimeout(liquidateAndRepeat, parseInt(process.env.LIQUIDATION_INTERVAL_SECONDS || '30') * 1000);
}

(async function () {
    if (process.env.LIQUIDATION_STRATEGY === "") {
        for (const tokenAddress of process.env.SUPPORTED_OUTPUT_CURRENCIES!.split(',')) {
            console.log(tokenAddress, "TOKEN ADDDRES")
            if (tokenAddress == "ETH") {
                await approveTokensToSafeLiquidator(constants.AddressZero);
            } else {
                await approveTokensToSafeLiquidator(tokenAddress);
            }

        }
    }
    liquidateAndRepeat();
})();
