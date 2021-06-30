const Web3 = require("web3");
const Big = require("big.js");
const axios = require("axios");
const ethers = require('ethers');
const { FlashbotsBundleProvider } = require('@flashbots/ethers-provider-bundle')

const fusePoolLensAbi = require(__dirname + '/abi/FusePoolLens.json');
const fuseSafeLiquidatorAbi = require(__dirname + '/abi/FuseSafeLiquidator.json');
const erc20Abi = require(__dirname + '/abi/ERC20.json');

// Set Big.js rounding mode to round down
Big.RM = 0;

var web3 = new Web3(new Web3.providers.HttpProvider(process.env.WEB3_HTTP_PROVIDER_URL));

var fusePoolLens = new web3.eth.Contract(fusePoolLensAbi, process.env.FUSE_POOL_LENS_CONTRACT_ADDRESS);
var fuseSafeLiquidator = new web3.eth.Contract(fuseSafeLiquidatorAbi, process.env.FUSE_SAFE_LIQUIDATOR_CONTRACT_ADDRESS);

const provider = new ethers.providers.JsonRpcProvider({ url: process.env.WEB3_HTTP_PROVIDER_URL });
const authSigner = new ethers.Wallet(process.env.ETHEREUM_ADMIN_PRIVATE_KEY);

const UNISWAP_V2_PROTOCOLS = {
    "Uniswap": {
        router: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
        factory: "0x5c69bee701ef814a2b6a3edd4b1652cb9cc5aa6f"
    },
    "SushiSwap": {
        router: "0xd9e1ce17f2641f24ae83637ab66a2cca9c378b9f",
        factory: "0xc0aee478e3658e2610c5f7a4a2e1777ce9e4f2ac"
    }
};

async function approveTokensToSafeLiquidator(erc20Address, amount) {
    // Build data
    var token = new web3.eth.Contract(erc20Abi, erc20Address);
    var data = token.methods.approve(amount).encodeABI();

    // Build transaction
    var tx = {
        from: process.env.ETHEREUM_ADMIN_ACCOUNT,
        to: erc20Address,
        value: 0,
        data: data,
        nonce: await web3.eth.getTransactionCount(process.env.ETHEREUM_ADMIN_ACCOUNT)
    };

    if (process.env.NODE_ENV !== "production") console.log("Signing and sending " + erc20Address + " approval transaction:", tx);

    // Estimate gas for transaction
    try {
        tx["gas"] = await web3.eth.estimateGas(tx);
    } catch (error) {
        throw "Failed to estimate gas before signing and sending " + erc20Address + " approval transaction: " + error;
    }
    
    // Sign transaction
    try {
        var signedTx = await web3.eth.accounts.signTransaction(tx, process.env.ETHEREUM_ADMIN_PRIVATE_KEY);
    } catch (error) {
        throw "Error signing " + erc20Address + " approval transaction: " + error;
    }

    // Send transaction
    try {
        var sentTx = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);
    } catch (error) {
        throw "Error sending " + erc20Address + " approval transaction: " + error;
    }
    
    console.log("Successfully sent " + erc20Address + " approval transaction:", sentTx);
    return sentTx;
}

async function sendTransactionToSafeLiquidator(method, params, value, gasLimit, flashbots) {
    // Build data
    var data = fuseSafeLiquidator.methods[method](...params).encodeABI();

    // Build transaction
    var tx = {
        from: process.env.ETHEREUM_ADMIN_ACCOUNT,
        to: fuseSafeLiquidator.options.address,
        value: value,
        data: data,
        nonce: await web3.eth.getTransactionCount(process.env.ETHEREUM_ADMIN_ACCOUNT),
        gas: gasLimit
    };

    if (flashbots) {
        // Get FlashbotsBundleProvider
        const flashbotsProvider = await FlashbotsBundleProvider.create(provider, authSigner);

        // Modify tx object
        tx.value = "0x" + Web3.utils.toBN(tx.value).toString(16);
        delete tx.nonce;
        delete tx.gas;
        tx.gasLimit = "0x" + Web3.utils.toBN(gasLimit).toString(16);
        tx.gasPrice = "0x0";

        // Sign
        if (process.env.NODE_ENV !== "production") console.log("Signing and sending", method, "transaction (via flashbots):", tx);

        const signedBundle = await flashbotsProvider.signBundle([{
            signer: authSigner,
            transaction: tx
        }]);

        if (process.env.NODE_ENV !== "production") console.log("Signed bundle for flashbots:", signedBundle);

        // Simulate
        const blockNumber = await web3.eth.getBlockNumber();
        var simulation = await flashbotsProvider.simulate(signedBundle, blockNumber + 1 );
        if (process.env.NODE_ENV !== "production") console.log("Simulated bundle for flashbots:", simulation);
        if ("error" in simulation || simulation.firstRevert !== undefined) throw "Error simulating flashbots-enabled " + method, "transaction: " + error;

        // Send bundles
        for (var i = blockNumber + 1; i < blockNumber + 12; i++) {
            var bundleReceipt = await flashbotsProvider.sendRawBundle(signedBundle, i)
            if (process.env.NODE_ENV !== "production" && i == blockNumber + 1) console.log("First bundle receipt (of 10):", bundleReceipt);
        }

        console.log("Successfully sent Flashbots bundles!");
        return bundleReceipt;
    } else {
        if (process.env.NODE_ENV !== "production") console.log("Signing and sending", method, "transaction:", tx);
        
        // Sign transaction
        try {
            var signedTx = await web3.eth.accounts.signTransaction(tx, process.env.ETHEREUM_ADMIN_PRIVATE_KEY);
        } catch (error) {
            throw "Error signing " + method + " transaction: " + error;
        }

        // Send transaction
        try {
            var sentTx = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);
        } catch (error) {
            throw "Error sending " + method + " transaction: " + error;
        }
    
        console.log("Successfully sent", method, "transaction:", sentTx);
        return sentTx;
    }
}

async function liquidateUnhealthyBorrows() {
    var liquidations = await getPotentialLiquidations();

    for (const comptroller of Object.keys(liquidations))
        for (const liquidation of liquidations[comptroller])
            try {
                await sendTransactionToSafeLiquidator(liquidation[0], liquidation[1], liquidation[2], liquidation[3], liquidation[4]);
            } catch { }
}

async function getPotentialLiquidations() {
    var pools = {};

    // Get potential liquidations from public pools
    if (process.env.SUPPORT_ALL_PUBLIC_POOLS) {
        var data = await fusePoolLens.methods.getPublicPoolUsersWithData(Web3.utils.toBN(1e18)).call({ gas: 1e18 });
        var comptrollers = data["0"];
        var users = data["1"];
        var closeFactors = data["2"];
        var liquidationIncentives = data["3"];

        for (var i = 0; i < comptrollers.length; i++) {
            users[i].slice().sort((a, b) => parseInt(b.totalBorrow) - parseInt(a.totalBorrow));
            var liquidations = [];

            for (var j = 0; j < users[i].length; j++) {
                var liquidation = await getPotentialLiquidation(users[i][j], closeFactors[i], liquidationIncentives[i]);
                if (liquidation !== null) liquidations.push(liquidation);
            }

            if (liquidations.length > 0) pools[comptrollers[i]] = liquidations;
        }
    }

    // Get potential liquidations from supported pools (excluding the public pools that have already been checked)
    if (process.env.SUPPORTED_POOL_COMPTROLLERS.length > 0) {
        var potentialComptrollers = process.env.SUPPORTED_POOL_COMPTROLLERS.split(",");
        var comptrollers = [];
        for (const comptroller of potentialComptrollers) if (!pools[comptrollers[i]]) comptrollers.push(comptroller);

        var data = await fusePoolLens.methods.getPoolUsersWithData(comptrollers, Web3.utils.toBN(1e18)).call({ gas: 1e18 });
        var users = data["0"];
        var closeFactors = data["1"];
        var liquidationIncentives = data["2"];

        for (var i = 0; i < comptrollers.length; i++) {
            users[i].slice().sort((a, b) => parseInt(b.totalBorrow) - parseInt(a.totalBorrow));
            var liquidations = [];

            for (var j = 0; j < users[i].length; j++) {
                var liquidation = await getPotentialLiquidation(users[i][j], closeFactors[i], liquidationIncentives[i]);
                if (liquidation !== null) liquidations.push(liquidation);
            }

            if (liquidations.length > 0) pools[comptrollers[i]] = liquidations;
        }
    }

    return pools;
}

async function getPotentialLiquidation(borrower, closeFactor, liquidationIncentive) {
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

    // Sort debt and collateral from highest to lowest ETH value
    borrower.debt.sort((a, b) => b.borrowBalanceEth.gt(a.borrowBalanceEth) ? 1 : -1);
    borrower.collateral.sort((a, b) => b.supplyBalanceEth.gt(a.supplyBalanceEth) ? 1 : -1);

    // Check SUPPORTED_INPUT_CURRENCIES (if LIQUIDATION_STRATEGY === "")
    if (process.env.LIQUIDATION_STRATEGY === "" && process.env.SUPPORTED_INPUT_CURRENCIES.split(',').indexOf(borrower.debt[0].underlyingSymbol === "ETH" ? "ETH" : borrower.debt[0].underlyingToken) >= 0) return null;

    // Check SUPPORTED_OUTPUT_CURRENCIES: replace EXCHANGE_TO_TOKEN_ADDRESS with underlying collateral if underlying collateral is in SUPPORTED_OUTPUT_CURRENCIES
    var exchangeToTokenAddress = process.env.EXCHANGE_TO_TOKEN_ADDRESS;
    if (process.env.EXCHANGE_TO_TOKEN_ADDRESS === "" || process.env.SUPPORTED_OUTPUT_CURRENCIES.split(',').indexOf(borrower.collateral[0].underlyingSymbol === "ETH" ? "ETH" : borrower.collateral[0].underlyingToken) >= 0) exchangeToTokenAddress = borrower.collateral[0].underlyingSymbol === "ETH" ? "ETH" : borrower.collateral[0].underlyingToken;

    // Get exchangeToTokenAddress price and decimals
    var [outputPrice, outputDecimals] = await getCurrencyEthPriceAndDecimals(exchangeToTokenAddress);

    // exchangeToTokenAddress to 0x0000000000000000000000000000000000000000 if ETH
    if (exchangeToTokenAddress === "ETH") exchangeToTokenAddress = "0x0000000000000000000000000000000000000000";

    // Get debt and collateral prices
    const underlyingDebtPrice = (new Big(borrower.debt[0].underlyingPrice)).div((new Big(10)).pow(36 - borrower.debt[0].underlyingDecimals));
    const underlyingCollateralPrice = (new Big(borrower.collateral[0].underlyingPrice)).div((new Big(10)).pow(36 - borrower.collateral[0].underlyingDecimals));

    // Get liquidation amount
    var liquidationAmountScaled = (new Big(borrower.debt[0].borrowBalance)).mul(closeFactor);
    var liquidationAmount = liquidationAmountScaled.div((new Big(10)).pow(parseInt(borrower.debt[0].underlyingDecimals)));
    var liquidationValueEth = liquidationAmount.mul(underlyingDebtPrice);

    // Get seize amount
    var seizeAmountEth = liquidationValueEth.mul(liquidationIncentive);
    var seizeAmount = seizeAmountEth.div(underlyingCollateralPrice);

    // Check if actual collateral is too low to seize seizeAmount; if so, recalculate liquidation amount
    const actualCollateral = (new Big(borrower.collateral[0].supplyBalance)).div((new Big(10)).pow(parseInt(borrower.collateral[0].underlyingDecimals)));
    
    if (seizeAmount.gt(actualCollateral)) {
        seizeAmount = actualCollateral;
        seizeAmountEth = seizeAmount.mul(underlyingCollateralPrice);
        liquidationValueEth = seizeAmountEth.div(liquidationIncentive);
        liquidationAmount = liquidationValueEth.div(underlyingDebtPrice);
        liquidationAmountScaled = liquidationAmount.mul((new Big(10)).pow(parseInt(borrower.debt[0].underlyingDecimals)));
    }

    // Convert liquidationAmountScaled to string
    liquidationAmountScaled = liquidationAmountScaled.toFixed(0);

    // Get collateral Uniswap V2 router
    var uniswapV2Router02ForCollateral = await getUniswapV2RouterByPreference(borrower.collateral[0].underlyingToken);

    // Depending on liquidation strategy
    if (process.env.LIQUIDATION_STRATEGY === "") {
        // Estimate gas usage
        try {
            if (borrower.debt[0].underlyingSymbol === 'ETH') {
                var expectedGasAmount = await fuseSafeLiquidator.methods.safeLiquidate(borrower.account, borrower.debt[0].cToken, borrower.collateral[0].cToken, 0, exchangeToTokenAddress, uniswapV2Router02ForCollateral, [], []).estimateGas({ gas: 1e9, value: liquidationAmountScaled, from: process.env.ETHEREUM_ADMIN_ACCOUNT });
            } else {
                var expectedGasAmount = await fuseSafeLiquidator.methods.safeLiquidate(borrower.account, liquidationAmountScaled, borrower.debt[0].cToken, borrower.collateral[0].cToken, 0, exchangeToTokenAddress, uniswapV2Router02ForCollateral, [], []).estimateGas({ gas: 1e9, from: process.env.ETHEREUM_ADMIN_ACCOUNT });
            }
        } catch {
            var expectedGasAmount = 600000;
        }

        // Get gas fee
        const gasPrice = new Big(await web3.eth.getGasPrice()).div(1e18);
        const expectedGasFee = gasPrice.mul(expectedGasAmount);

        // Get min seize
        var minEthSeizeAmountBreakEven = expectedGasFee.add(liquidationValueEth);
        var minEthSeizeAmount = minEthSeizeAmountBreakEven.add(process.env.MINIMUM_PROFIT);
        var minSeizeAmount = minEthSeizeAmount.div(outputPrice);
        var minSeizeAmountScaled = minSeizeAmount.mul((new Big(10)).pow(outputDecimals)).toFixed(0);

        // Check expected seize against minSeizeAmount
        if (seizeAmount.lt(minSeizeAmount)) return null;

        // Return transaction
        if (borrower.debt[0].underlyingSymbol === 'ETH') {
            return ["safeLiquidate", [borrower.account, borrower.debt[0].cToken, borrower.collateral[0].cToken, minSeizeAmountScaled, exchangeToTokenAddress, uniswapV2Router02ForCollateral, [], []], liquidationAmountScaled, expectedGasAmount];
        } else {
            return ["safeLiquidate", [borrower.account, liquidationAmountScaled, borrower.debt[0].cToken, borrower.collateral[0].cToken, minSeizeAmountScaled, exchangeToTokenAddress, uniswapV2Router02ForCollateral, [], []], 0, expectedGasAmount];
        }
    } else if (process.env.LIQUIDATION_STRATEGY === "uniswap") {
        // Estimate gas usage
        try {
            if (borrower.debt[0].underlyingSymbol === 'ETH') {
                var expectedGasAmount = await fuseSafeLiquidator.methods.safeLiquidateToEthWithFlashLoan(borrower.account, liquidationAmountScaled, borrower.debt[0].cToken, borrower.collateral[0].cToken, 0, exchangeToTokenAddress, uniswapV2Router02ForCollateral, [], [], parseInt(process.env.FLASHBOTS_ENABLED) ? 1e6 : 0).estimateGas({ gas: 1e9, from: process.env.ETHEREUM_ADMIN_ACCOUNT });
            } else {
                var expectedGasAmount = await fuseSafeLiquidator.methods.safeLiquidateToTokensWithFlashLoan(borrower.account, liquidationAmountScaled, borrower.debt[0].cToken, borrower.collateral[0].cToken, 0, exchangeToTokenAddress, await getUniswapV2RouterByPreference(borrower.debt[0].underlyingToken), uniswapV2Router02ForCollateral, [], [], parseInt(process.env.FLASHBOTS_ENABLED) ? 1e6 : 0).estimateGas({ gas: 1e9, from: process.env.ETHEREUM_ADMIN_ACCOUNT });
            }
        } catch (error) {
            if (process.env.NODE_ENV !== "production") console.log("Failed to estimate gas for", liquidationValueEth.mul(liquidationIncentive.sub(1)).toFixed(4), "incentive liquidation:", error.message ? error.message : error);
            return null;
        }

        // Get gas fee
        const gasPrice = new Big(await web3.eth.getGasPrice()).div(1e18);
        const expectedGasFee = gasPrice.mul(expectedGasAmount);

        if (process.env.NODE_ENV !== "production") console.log("Gas fee for", liquidationValueEth.mul(liquidationIncentive.sub(1)).toFixed(4), "incentive liquidation:", expectedGasFee.toFixed(4), "ETH");

        // Get min profit
        var minOutputEth = (new Big(process.env.MINIMUM_PROFIT_ETH)).add(process.env.FLASHBOTS_ENABLED ? 0 : expectedGasFee);
        var minProfitAmountScaled = minOutputEth.div(outputPrice).mul((new Big(10)).pow(outputDecimals)).toFixed(0);

        // Return transaction
        if (borrower.debt[0].underlyingSymbol === 'ETH') {
            return ["safeLiquidateToEthWithFlashLoan", [borrower.account, liquidationAmountScaled, borrower.debt[0].cToken, borrower.collateral[0].cToken, minProfitAmountScaled, exchangeToTokenAddress, uniswapV2Router02ForCollateral, [], [], process.env.FLASHBOTS_ENABLED ? expectedGasFee.mul(process.env.FLASHBOTS_GAS_FEE_MULTIPLIER).mul(new Big(1e18)).toFixed(0) : 0], 0, (new Big(expectedGasAmount)).mul(process.env.GAS_LIMIT_MULTIPLIER).toFixed(0), process.env.FLASHBOTS_ENABLED];
        } else {
            return ["safeLiquidateToTokensWithFlashLoan", [borrower.account, liquidationAmountScaled, borrower.debt[0].cToken, borrower.collateral[0].cToken, minProfitAmountScaled, exchangeToTokenAddress, await getUniswapV2RouterByPreference(borrower.debt[0].underlyingToken), uniswapV2Router02ForCollateral, [], [], process.env.FLASHBOTS_ENABLED ? expectedGasFee.mul(process.env.FLASHBOTS_GAS_FEE_MULTIPLIER).mul(new Big(1e18)).toFixed(0) : 0], 0, (new Big(expectedGasAmount)).mul(process.env.GAS_LIMIT_MULTIPLIER).toFixed(0), process.env.FLASHBOTS_ENABLED];
        }
    } else throw "Invalid liquidation strategy";
}

async function getUniswapV2RouterByPreference(token) {
    // Return SushiSwap router if converting from or to RGT, YAM, or ALCX
    return token.toLowerCase() == "0xd291e7a03283640fdc51b121ac401383a46cc623" ||
        token.toLowerCase() == "0x0AaCfbeC6a24756c20D41914F2caba817C0d8521" ||
        token.toLowerCase() == "0xdbdb4d16eda451d0503b854cf79d55697f90c8df" ?
        "0xd9e1ce17f2641f24ae83637ab66a2cca9c378b9f" : "0x7a250d5630b4cf539739df2c5dacb4c659f2488d";
}

async function getUniswapV2RouterByBestWethLiquidity(token) {
    // Get best Uniswap market for this token
    var bestUniswapV2RouterForToken, bestUniswapLiquidityForToken = Fuse.Web3.utils.toBN(0);
    var uniswapV2FactoryAbi = [{"constant":true,"inputs":[{"internalType":"address","name":"","type":"address"},{"internalType":"address","name":"","type":"address"}],"name":"getPair","outputs":[{"internalType":"address","name":"","type":"address"}],"payable":false,"stateMutability":"view","type":"function"}];
    var uniswapV2PairAbi = [{"constant":true,"inputs":[],"name":"getReserves","outputs":[{"internalType":"uint112","name":"_reserve0","type":"uint112"},{"internalType":"uint112","name":"_reserve1","type":"uint112"},{"internalType":"uint32","name":"_blockTimestampLast","type":"uint32"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":true,"inputs":[],"name":"token0","outputs":[{"internalType":"address","name":"","type":"address"}],"payable":false,"stateMutability":"view","type":"function"}];
    for (const uniswapV2 of Object.values(UNISWAP_V2_PROTOCOLS)) {
        var uniswapV2Factory = new fuse.web3.eth.Contract(uniswapV2FactoryAbi, uniswapV2.factory);
        var uniswapV2Pair = await uniswapV2Factory.methods.getPair(token, Fuse.WETH_ADDRESS).call();
        if (uniswapV2Pair == "0x0000000000000000000000000000000000000000") continue;
        uniswapV2Pair = new fuse.web3.eth.Contract(uniswapV2PairAbi, uniswapV2Pair);
        var reserves = await uniswapV2Pair.methods.getReserves().call();
        var wethLiquidity = Fuse.Web3.utils.toBN(reserves[(await uniswapV2Pair.methods.token0().call()).toLowerCase() == Fuse.WETH_ADDRESS.toLowerCase() ? "0" : "1"])
        if (wethLiquidity.gt(bestUniswapLiquidityForToken)) {
            bestUniswapV2RouterForToken = uniswapV2.router;
            bestUniswapLiquidityForToken = wethLiquidity;
        }
    }
    return [bestUniswapV2RouterForToken, bestUniswapLiquidityForToken];
}

async function getPrice(tokenAddress) {
    tokenAddress = tokenAddress.toLowerCase();

    // Get ETH-based price of an ERC20 via CoinGecko
    var decoded = (await axios.get('https://api.coingecko.com/api/v3/simple/token_price/ethereum', {
        params: {
            vs_currencies: "eth",
            contract_addresses: tokenAddress
        }
    })).data;
    if (!decoded || !decoded[tokenAddress]) throw "Failed to decode price of " + tokenAddress + " from CoinGecko";
    return decoded[tokenAddress].eth;
}

var currencyDecimalsCache = {};
var currencyPriceCache = {};

async function getCurrencyEthPriceAndDecimals(tokenAddressOrEth) {
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
    if (currencyDecimalsCache[tokenAddressOrEth] === undefined) currencyDecimalsCache[tokenAddressOrEth] = tokenAddressOrEth === "ETH" ? 18 : parseInt(await (new web3.eth.Contract(erc20Abi, tokenAddressOrEth)).methods.decimals().call());
    var epochNow = (new Date()).getTime() / 1000;

    return [currencyPriceCache[tokenAddressOrEth].value, currencyDecimalsCache[tokenAddressOrEth]];
}

// Liquidate unhealthy borrows and repeat every LIQUIDATION_INTERVAL_SECONDS
async function liquidateAndRepeat() {
    await liquidateUnhealthyBorrows();
    setTimeout(liquidateAndRepeat, process.env.LIQUIDATION_INTERVAL_SECONDS * 1000);
}

(async function() {
    if (process.env.LIQUIDATION_STRATEGY === "") for (const tokenAddress of process.env.SUPPORTED_INPUT_CURRENCIES.split(',')) if (tokenAddress !== "ETH") await approveTokensToSafeLiquidator(tokenAddress, web3.utils.toBN(2).pow(web3.utils.toBN(256)).subn(1));
    liquidateAndRepeat();
})();
