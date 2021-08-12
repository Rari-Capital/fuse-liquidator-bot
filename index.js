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

const COLLATERAL_REDEMPTION_STRATEGIES = {
    CurveLpToken: "0xb5eEaeB4E7e0a9feD003ED402016342A09FC2784",
    CurveLiquidityGaugeV2: "0x97e6E953C9a9250c8e889D888158F27752e0aFe0",
    YearnYVaultV2: "0x50293EB96E90616faD66CEF227EDA2b344F592c0",
    PoolTogether: "0xDDB0d86fDBF33210Ba6EFc97757fFcdBF26B5530", 
    UniswapV2: "0x8db1884def49b001c0b9b2fd5ba8e8b71f69b958",
    UniswapV1: "0x9fa9ffa397be8e33930571dcd9f5f92b629b0fad",
    CurveSwap: "0xebea141052d759b75c4c9eeaad28f07f329d0163",
    WSTEth: "0xca844845a3578296b3fcfe50fc3a1064a2922fbc",
    SOhm: "0xeBC0752232697F17EbfAA1f26aB8543EcEC35AE3",
    UniswapV3: "0x5E829D997294F7f1d40a45C0f6431aF13a381E63",
    SushiBar: "0x5F2dF200636e203863819CbEaA02017CFabEc4D6"
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

    console.log("Signing and sending " + erc20Address + " approval transaction:", process.env.NODE_ENV !== "production" ? tx : "");

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
    
    console.log("Successfully sent " + erc20Address + " approval transaction:", process.env.NODE_ENV !== "production" ? sentTx : sentTx.transactionHash);
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

    // Flashbots?
    if (flashbots) {
        const flashbotsProvider = await FlashbotsBundleProvider.create(provider, authSigner);

        // Format transaction
        tx.value = "0x" + Web3.utils.toBN(tx.value).toString(16);
        delete tx.nonce;
        delete tx.gas;
        tx.gasLimit = "0x" + Web3.utils.toBN(gasLimit).toString(16);
        tx.gasPrice = "0x0";

        // Sign bundle
        console.log("Signing, simulating, and sending", method, "transaction (via flashbots):", process.env.NODE_ENV !== "production" ? tx : "");

        try {
            var signedBundle = await flashbotsProvider.signBundle([{
                signer: authSigner,
                transaction: tx
            }]);
        } catch (error) {
            throw "Error when signing flashbots transaction: " + error;
        }

        if (process.env.NODE_ENV !== "production") console.log("Signed bundle for flashbots:", signedBundle);

        // Simulate bundle
        const blockNumber = await web3.eth.getBlockNumber();
        var simulation = await flashbotsProvider.simulate(signedBundle, blockNumber + 1 );
        if (process.env.NODE_ENV !== "production") console.log("Simulated bundle for flashbots:", simulation);
        if (simulation.results[0].error !== undefined || simulation.firstRevert !== undefined) throw "Error simulating flashbots-enabled " + method, "transaction: " + error;

        // Send bundle
        for (var i = blockNumber + 1; i < blockNumber + 12; i++) {
            var bundleReceipt = await flashbotsProvider.sendRawBundle(signedBundle, i)
            if (process.env.NODE_ENV !== "production" && i == blockNumber + 1) console.log("First bundle receipt (of 10):", bundleReceipt);
        }

        console.log("Successfully sent", method, "flashbots bundles!", process.env.NODE_ENV !== "production" ? bundleReceipt : "");
        return bundleReceipt;
    } else {
        console.log("Signing and sending", method, "transaction:", process.env.NODE_ENV !== "production" ? tx : "");
        
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

        console.log("Successfully sent", method, "transaction:", process.env.NODE_ENV !== "production" ? sentTx : sentTx.transactionHash);
        return sentTx;
    }
}

async function liquidateUnhealthyBorrows() {
    var liquidations = await getPotentialLiquidations();

    for (const comptroller of Object.keys(liquidations))
        for (const liquidation of liquidations[comptroller])
            (async function() {
                try {
                    await sendTransactionToSafeLiquidator(liquidation[0], liquidation[1], liquidation[2], liquidation[3], liquidation[4]);
                } catch (error) { console.log(error); }
            })();
}

async function getPotentialLiquidations() {
    // Get gas price
    var gasPrice = new Big(await web3.eth.getGasPrice()).div(1e18);
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
                var liquidation = await getPotentialLiquidation(users[i][j], closeFactors[i], liquidationIncentives[i], gasPrice);
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
                var liquidation = await getPotentialLiquidation(users[i][j], closeFactors[i], liquidationIncentives[i], gasPrice);
                if (liquidation !== null) liquidations.push(liquidation);
            }

            if (liquidations.length > 0) pools[comptrollers[i]] = liquidations;
        }
    }

    return pools;
}

async function getPotentialLiquidation(borrower, closeFactor, liquidationIncentive, gasPrice) {
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

    // Get collateral Uniswap V2 router and redemption strategy/data if applicable
    var [uniswapV2Router02ForCollateral, redemptionStrategies, strategyData] = await getCollateralStrategies(borrower.collateral[0].underlyingToken);

    // Depending on liquidation strategy
    if (process.env.LIQUIDATION_STRATEGY === "") {
        // Estimate gas usage
        try {
            if (borrower.debt[0].underlyingSymbol === 'ETH') {
                var expectedGasAmount = await fuseSafeLiquidator.methods.safeLiquidate(borrower.account, borrower.debt[0].cToken, borrower.collateral[0].cToken, 0, exchangeToTokenAddress).estimateGas({ gas: 1e9, value: liquidationAmountScaled, from: process.env.ETHEREUM_ADMIN_ACCOUNT });
            } else {
                var expectedGasAmount = await fuseSafeLiquidator.methods.safeLiquidate(borrower.account, liquidationAmountScaled, borrower.debt[0].cToken, borrower.collateral[0].cToken, 0, exchangeToTokenAddress).estimateGas({ gas: 1e9, from: process.env.ETHEREUM_ADMIN_ACCOUNT });
            }
        } catch {
            return null;
        }

        // Get gas fee
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
            return ["safeLiquidate", [borrower.account, borrower.debt[0].cToken, borrower.collateral[0].cToken, minSeizeAmountScaled, exchangeToTokenAddress], liquidationAmountScaled, expectedGasAmount];
        } else {
            return ["safeLiquidate", [borrower.account, liquidationAmountScaled, borrower.debt[0].cToken, borrower.collateral[0].cToken, minSeizeAmountScaled, exchangeToTokenAddress], 0, expectedGasAmount];
        }
    } else if (process.env.LIQUIDATION_STRATEGY === "uniswap") {
        // Estimate gas usage
        try {
            if (borrower.debt[0].underlyingSymbol === 'ETH') {
                var expectedGasAmount = await fuseSafeLiquidator.methods.safeLiquidateToEthWithFlashLoan(borrower.account, liquidationAmountScaled, borrower.debt[0].cToken, borrower.collateral[0].cToken, 0, exchangeToTokenAddress, uniswapV2Router02ForCollateral, redemptionStrategies, strategyData, parseInt(process.env.FLASHBOTS_ENABLED) ? 1e6 : 0).estimateGas({ gas: 1e9, from: process.env.ETHEREUM_ADMIN_ACCOUNT });
            } else {
                var expectedGasAmount = await fuseSafeLiquidator.methods.safeLiquidateToTokensWithFlashLoan(borrower.account, liquidationAmountScaled, borrower.debt[0].cToken, borrower.collateral[0].cToken, 0, exchangeToTokenAddress, await getUniswapV2RouterByPreference(borrower.debt[0].underlyingToken), uniswapV2Router02ForCollateral, redemptionStrategies, strategyData, parseInt(process.env.FLASHBOTS_ENABLED) ? 1e6 : 0).estimateGas({ gas: 1e9, from: process.env.ETHEREUM_ADMIN_ACCOUNT });
            }
        } catch (error) {
            if (process.env.NODE_ENV !== "production") console.log("Failed to estimate gas for", liquidationValueEth.mul(liquidationIncentive.sub(1)).toFixed(4), "incentive liquidation:", error.message ? error.message : error);
            return null;
        }

        // Get gas fee
        const expectedGasFee = gasPrice.mul(expectedGasAmount);
        if (process.env.NODE_ENV !== "production") console.log("Gas fee for", liquidationValueEth.mul(liquidationIncentive.sub(1)).toFixed(4), "incentive liquidation:", expectedGasFee.toFixed(4), "ETH");

        // Get min profit
        var minOutputEth = (new Big(process.env.MINIMUM_PROFIT_ETH)).add(process.env.FLASHBOTS_ENABLED ? 0 : expectedGasFee);
        var minProfitAmountScaled = minOutputEth.div(outputPrice).mul((new Big(10)).pow(outputDecimals)).toFixed(0);

        // Return transaction
        if (borrower.debt[0].underlyingSymbol === 'ETH') {
            return ["safeLiquidateToEthWithFlashLoan", [borrower.account, liquidationAmountScaled, borrower.debt[0].cToken, borrower.collateral[0].cToken, minProfitAmountScaled, exchangeToTokenAddress, uniswapV2Router02ForCollateral, redemptionStrategies, strategyData, process.env.FLASHBOTS_ENABLED ? expectedGasFee.mul(process.env.FLASHBOTS_GAS_FEE_MULTIPLIER).mul(new Big(1e18)).toFixed(0) : 0], 0, (new Big(expectedGasAmount)).mul(process.env.GAS_LIMIT_MULTIPLIER).toFixed(0), process.env.FLASHBOTS_ENABLED];
        } else {
            return ["safeLiquidateToTokensWithFlashLoan", [borrower.account, liquidationAmountScaled, borrower.debt[0].cToken, borrower.collateral[0].cToken, minProfitAmountScaled, exchangeToTokenAddress, await getUniswapV2RouterByPreference(borrower.debt[0].underlyingToken), uniswapV2Router02ForCollateral, redemptionStrategies, strategyData, process.env.FLASHBOTS_ENABLED ? expectedGasFee.mul(process.env.FLASHBOTS_GAS_FEE_MULTIPLIER).mul(new Big(1e18)).toFixed(0) : 0], 0, (new Big(expectedGasAmount)).mul(process.env.GAS_LIMIT_MULTIPLIER).toFixed(0), process.env.FLASHBOTS_ENABLED];
        }
    } else throw "Invalid liquidation strategy";
}

async function getUniswapV2RouterByPreference(token) {
    // Return SushiSwap router if converting from or to RGT, YAM, ALCX, or yveCRV-DAO
    return token.toLowerCase() == "0xd291e7a03283640fdc51b121ac401383a46cc623".toLowerCase() ||
        token.toLowerCase() == "0x0AaCfbeC6a24756c20D41914F2caba817C0d8521".toLowerCase() ||
        token.toLowerCase() == "0xdbdb4d16eda451d0503b854cf79d55697f90c8df".toLowerCase() ||
        token.toLowerCase() == "0xc5bddf9843308380375a611c18b50fb9341f502a".toLowerCase() ?
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

async function getCollateralStrategies(token) {
    if (token.toLowerCase() == "0xcee60cfa923170e4f8204ae08b4fa6a3f5656f3a".toLowerCase()) strategies = ["CurveLpToken"]; // linkCRV
    if (token.toLowerCase() == "0xfd4d8a17df4c27c1dd245d153ccf4499e806c87d".toLowerCase()) strategies = ["CurveLiquidityGaugeV2"]; // linkCRV-gauge
    if (token.toLowerCase() == "0xf2db9a7c0ACd427A680D640F02d90f6186E71725".toLowerCase()) strategies = ["YearnYVaultV2", "CurveLpToken"]; // yvCurve-LINK
    if (token.toLowerCase() == "0x986b4AFF588a109c09B50A03f42E4110E29D353F".toLowerCase()) strategies = ["YearnYVaultV2", "CurveLpToken"]; // yvCurve-sETH
    if (token.toLowerCase() == "0xd81b1a8b1ad00baa2d6609e0bae28a38713872f7".toLowerCase()) strategies = ["PoolTogether"]; // PcUSDC
    if (token.toLowerCase() == "0xa258c4606ca8206d8aa700ce2143d7db854d168c".toLowerCase()) strategies = ["YearnYVaultV2"]; // yvWETH
    if (token.toLowerCase() == "0x19d3364a399d251e894ac732651be8b0e4e85001".toLowerCase()) strategies = ["YearnYVaultV2"]; // yvDAI
    if (token.toLowerCase() == "0x5f18c75abdae578b483e5f43f12a39cf75b973a9".toLowerCase()) strategies = ["YearnYVaultV2"]; // yvUSDC
    if (token.toLowerCase() == "0xcb550a6d4c8e3517a939bc79d0c7093eb7cf56b5".toLowerCase()) strategies = ["YearnYVaultV2"]; // yvWBTC
    if (token.toLowerCase() == "0x9d409a0a012cfba9b15f6d4b36ac57a46966ab9a".toLowerCase()) strategies = ["YearnYVaultV2"]; // yvBOOST
    if (token.toLowerCase() == "0x31932e6e45012476ba3a3a4953cba62aee77fbbe".toLowerCase()) strategies = ["SOhm", "UniswapV2Liquidator"]; // sOHM
    if (token.toLowerCase() == "0xc7283b66Eb1EB5FB86327f08e1B5816b0720212B".toLowerCase()) strategies = ["UniswapV2"]; // TRIBE
    if (token.toLowerCase() == "0x23b608675a2b2fb1890d3abbd85c5775c51691d5".toLowerCase()) strategies = ["UniswapV1"]; // SOCKS
    if (token.toLowerCase() == "0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0".toLowerCase()) strategies = ["WSTEth", "CurveSwap"]; // wstETH
    if (token.toLowerCase() == "0xc53342fd7575f572b0ff4569e31941a5b821ac76".toLowerCase() || token.toLowerCase() == "0x3a707d56d538e85b783e8ce12b346e7fb6511f90".toLowerCase() || token.toLowerCase() == "0x51b0bcbeff204b39ce792d1e16767fe6f7631970".toLowerCase() || token.toLowerCase() == "0x2590f1fd14ef8bb0a46c7a889c4cbc146510f9c3".toLowerCase()) strategies = ["UniswapV3"]; // ETHV, iETHV, BTCV, iBTCV
    return getCollateralStrategiesData(token, []);
}

async function getCollateralStrategiesData(token, strategies) {
    var datas = [];
    var lastUniswapV2Router = undefined; // Ignore UniswapV2Routers of the first strategies if we have multiple; we only care about the last one

    for (var i = 0; i < strategies.length; i++) {
        var [data, uniswapV2Router] = getCollateralStrategyData(token, strategies[i]);
        datas[i] = data;
        strategies[i] = COLLATERAL_REDEMPTION_STRATEGIES[strategies[i]];
        if (uniswapV2Router) lastUniswapV2Router = uniswapV2Router;
    }

    if (!lastUniswapV2Router) lastUniswapV2Router = await getUniswapV2RouterByPreference(token);
    return [lastUniswapV2Router, datas, strategies];
}

async function getCollateralStrategyData(token, strategy) {
    if (strategy == "CurveLiquidityGaugeV2") {
        // Get coins underlying LP token underling gauge
        var gaugeAbi = [{"name":"lp_token","outputs":[{"type":"address","name":""}],"inputs":[],"stateMutability":"view","type":"function","gas":1871}];
        var gauge = new fuse.web3.eth.Contract(gaugeAbi, token);
        token = await gauge.methods.lp_token().call();
        strategy = "CurveLpToken";
    }
  
    if (strategy == "CurveLpToken") {
        // Get Curve pool coins
        var registryAbi = [{"name":"get_coins","outputs":[{"type":"address[8]","name":""}],"inputs":[{"type":"address","name":"_pool"}],"stateMutability":"view","type":"function","gas":12285},{"name":"get_pool_from_lp_token","outputs":[{"type":"address","name":""}],"inputs":[{"type":"address","name":"arg0"}],"stateMutability":"view","type":"function","gas":2446}];
        var registry = new fuse.web3.eth.Contract(registryAbi, "0x7D86446dDb609eD0F5f8684AcF30380a356b2B4c");
        var pool = await registry.methods.get_pool_from_lp_token(token).call();
        var coins = await registry.methods.get_coins(pool).call();
    
        // Get ideal output coin and Uniswap market by best swap liquidity
        var bestCurveCoinIndex, bestUnderlying, bestUniswapV2Router, bestUniswapLiquidity = 0;
    
        for (var i = 0; i < coins.length; i++) {
            // Break if we have iterated through all coins
            if (coins[i] == "0x0000000000000000000000000000000000000000") break;
    
            // Break if coin is WETH
            if (coins[i].toLowerCase() == Fuse.WETH_ADDRESS.toLowerCase()) {
                bestUniswapV2Router = UNISWAP_V2_PROTOCOLS.Uniswap.router;
                bestCurveCoinIndex = i;
                bestUnderlying = coins[i];
                break;
            }
    
            // Get best Uniswap market for this token
            var [bestUniswapV2RouterForToken, bestUniswapLiquidityForToken] = await getUniswapV2RouterByBestWethLiquidity(coins[i]);
    
            // If this token's best Uniswap liquidity is better than the rest, use it
            if (bestUniswapLiquidityForToken > bestUniswapLiquidity) {
                bestCurveCoinIndex = i;
                bestUnderlying = coins[i];
                bestUniswapV2Router = bestUniswapV2RouterForToken;
                bestUniswapLiquidity = bestUniswapLiquidityForToken;
            }
        }
    
        // Return strategy data and Uniswap V2 router
        return [fuse.web3.eth.abi.encodeParameters(['uint8', 'address'], [bestCurveCoinIndex, bestUnderlying]), bestUniswapV2Router];
    }
    
    if (strategy == "UniswapLiquidator") {
      if (token.toLowerCase() == "0x383518188c0c6d7730d91b2c03a03c837814a899".toLowerCase()) return [fuse.web3.eth.abi.encodeParameters(['address', 'address[]'], [UNISWAP_V2_PROTOCOLS.SushiSwap.router, ["0x383518188c0c6d7730d91b2c03a03c837814a899", "0x6b175474e89094c44da98b954eedeac495271d0f"]]), UNISWAP_V2_PROTOCOLS.Uniswap.router]; // OHM => DAI
      if (token.toLowerCase() == "0xc7283b66Eb1EB5FB86327f08e1B5816b0720212B".toLowerCase()) return [fuse.web3.eth.abi.encodeParameters(['address', 'address[]'], [UNISWAP_V2_PROTOCOLS.Uniswap.router, ["0xc7283b66Eb1EB5FB86327f08e1B5816b0720212B", "0x956F47F50A910163D8BF957Cf5846D573E7f87CA"]]), UNISWAP_V2_PROTOCOLS.Uniswap.router]; // TRIBE => FEI
    }

    if (strategy == "CurveSwap") {
      // Get Curve pool for token => WETH
      var registryAbi = [{"name":"find_pool_for_coins","outputs":[{"type":"address","name":""}],"inputs":[{"type":"address","name":"_from"},{"type":"address","name":"_to"}],"stateMutability":"view","type":"function"},{"name":"get_coin_indices","outputs":[{"type":"int128","name":""},{"type":"int128","name":""},{"type":"bool","name":""}],"inputs":[{"type":"address","name":"_pool"},{"type":"address","name":"_from"},{"type":"address","name":"_to"}],"stateMutability":"view","type":"function","gas":27456}];
      var registry = new fuse.web3.eth.Contract(registryAbi, "0x7D86446dDb609eD0F5f8684AcF30380a356b2B4c");
      var pool = await registry.methods.find_pool_for_coins(token, "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE").call();
      var indices = await registry.methods.get_coin_indices(pool, token, "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE").call();

      // Return strategy data and Uniswap V2 router
      return [fuse.web3.eth.abi.encodeParameters(['address', 'int128', 'int128', 'address'], [pool, indices["0"], indices["1"], "0x0000000000000000000000000000000000000000"]), UNISWAP_V2_PROTOCOLS.Uniswap.router];
    }

    return ["0x0", undefined];
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
