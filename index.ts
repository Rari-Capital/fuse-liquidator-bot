'use strict'

import { liquidateAndRepeat, approveTokensToSafeLiquidator } from "./lib";

const inquirer = require("inquirer");
const Web3 = require("web3");

const fusePoolDirectoryAbi = require('./abi/FusePoolDirectory.json');
const fuseSafeLiquidatorAbi = require('./abi/FuseSafeLiquidator.json');

// * Import env variables
require('dotenv').config({path: './.env'})

// * Run liquidation
const runLiquidator = async () => {
    // * Get web3 from HTTP Provider
    var web3 = new Web3(new Web3.providers.HttpProvider(process.env.WEB3_HTTP_PROVIDER_URL));

    // * Get Fuse Contracts
    var fusePoolDirectory = new web3.eth.Contract(fusePoolDirectoryAbi, process.env.FUSE_POOL_DIRECTORY_CONTRACT_ADDRESS);
    var fuseSafeLiquidator = new web3.eth.Contract(fuseSafeLiquidatorAbi, process.env.FUSE_SAFE_LIQUIDATOR_CONTRACT_ADDRESS);

    // * Attempt to read environment variables
    if(process.env.NODE_ENV) console.info("Successfully read environment variables.");
    else console.error("Failed to read environment variables!");

    // * Process liquidation strategy and liquidate and repeat
    if (process.env.LIQUIDATION_STRATEGY === "") for (const tokenAddress of process.env.SUPPORTED_INPUT_CURRENCIES.split(',')) if (tokenAddress !== "ETH") await approveTokensToSafeLiquidator({ erc20address: tokenAddress, amount: web3.utils.toBN(2).pow(web3.utils.toBN(256)).subn(1), web3});
    liquidateAndRepeat({ fusePoolDirectory: fusePoolDirectory, fuseSafeLiquidator: fuseSafeLiquidator, web3: web3 });
};

const taskQuestion = {
    name: 'Task',
    type: 'list',
    message: 'Select a Task',
    choices: ['Run Liquidator', 'Another option'],
};

// * Allow user to select environment
const environmentQuestion = {
    name: 'Environment',
    type: 'list',
    message: 'Select an Environment',
    choices: ['development', 'production'],
};

inquirer.prompt([taskQuestion, environmentQuestion]).then((answers) => {
    process.env.NODE_ENV = answers.Environment;
    if (answers.Task === 'Run Liquidator') {
        runLiquidator();
    } else if (answers.Task === 'Another Option') {
        console.info("More options coming soon...");
    }
});
