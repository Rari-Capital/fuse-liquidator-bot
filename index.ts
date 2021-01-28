import { liquidateAndRepeat, approveTokensToSafeLiquidator } from "./lib";

const Web3 = require("web3");

const fusePoolDirectoryAbi = require(__dirname + '/abi/FusePoolDirectory.json');
const fuseSafeLiquidatorAbi = require(__dirname + '/abi/FuseSafeLiquidator.json');
const erc20Abi = require(__dirname + '/abi/ERC20.json');


var fusePoolDirectory = new web3.eth.Contract(fusePoolDirectoryAbi, process.env.FUSE_POOL_DIRECTORY_CONTRACT_ADDRESS);
var fuseSafeLiquidator = new web3.eth.Contract(fuseSafeLiquidatorAbi, process.env.FUSE_SAFE_LIQUIDATOR_CONTRACT_ADDRESS);


var currencyDecimalsCache = {};
var currencyPriceCache = {};


(async function() {
    
    var web3 = new Web3(new Web3.providers.HttpProvider(process.env.WEB3_HTTP_PROVIDER_URL));
    if (process.env.LIQUIDATION_STRATEGY === "") for (const tokenAddress of process.env.SUPPORTED_INPUT_CURRENCIES.split(',')) if (tokenAddress !== "ETH") await approveTokensToSafeLiquidator(tokenAddress, web3.utils.toBN(2).pow(web3.utils.toBN(256)).subn(1), web3);
    liquidateAndRepeat();
})();

