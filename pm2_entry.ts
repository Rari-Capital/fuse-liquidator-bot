'use strict'

import { liquidateAndRepeat, approveTokensToSafeLiquidator } from "./lib";
const Web3 = require("web3");

const fusePoolDirectoryAbi = require('./abi/FusePoolDirectory.json');
const fuseSafeLiquidatorAbi = require('./abi/FuseSafeLiquidator.json');

const runLiquidator = async () => {
    // * Get web3 from HTTP Provider
    var web3 = new Web3(new Web3.providers.HttpProvider(process.env.WEB3_HTTP_PROVIDER_URL));

    // * Get Fuse Contracts
    var fusePoolDirectory = new web3.eth.Contract(fusePoolDirectoryAbi, process.env.FUSE_POOL_DIRECTORY_CONTRACT_ADDRESS);
    var fuseSafeLiquidator = new web3.eth.Contract(fuseSafeLiquidatorAbi, process.env.FUSE_SAFE_LIQUIDATOR_CONTRACT_ADDRESS);

    // * Process liquidation strategy and liquidate and repeat
    if (process.env.LIQUIDATION_STRATEGY === "") for (const tokenAddress of process.env.SUPPORTED_INPUT_CURRENCIES.split(',')) if (tokenAddress !== "ETH") await approveTokensToSafeLiquidator({ erc20address: tokenAddress, amount: web3.utils.toBN(2).pow(web3.utils.toBN(256)).subn(1), web3});
    liquidateAndRepeat({ fusePoolDirectory: fusePoolDirectory, fuseSafeLiquidator: fuseSafeLiquidator, web3: web3 });
};

console.info("Running liquidator...")
runLiquidator();
