import { getPrice } from ".";
const erc20Abi = require('../abi/ERC20.json');

const getCurrencyEthPriceAndDecimals = async ({ tokenAddressOrEth, web3 }) => {
    var currencyDecimalsCache = {};
    var currencyPriceCache = {};

    // * Quick return for ETH
    if (tokenAddressOrEth === "ETH") return [1, 18];

    // * Lowercase token address
    tokenAddressOrEth = tokenAddressOrEth.toLowerCase();

    // * Get price (from cache if possible)
    if (currencyPriceCache[tokenAddressOrEth] === undefined || currencyPriceCache[tokenAddressOrEth].lastUpdated < (epochNow - (60 * 15))) {
        currencyPriceCache[tokenAddressOrEth] = {
            lastUpdated: epochNow,
            value: await getPrice(tokenAddressOrEth)
        };
    }

    // * Get decimals (from cache if possible)
    if (currencyDecimalsCache[tokenAddressOrEth] === undefined) currencyDecimalsCache[tokenAddressOrEth] = tokenAddressOrEth === "ETH" ? 18 : parseInt(await (new web3.eth.Contract(erc20Abi, tokenAddressOrEth)).methods.decimals().call());
    var epochNow = (new Date()).getTime() / 1000;

    return [currencyPriceCache[tokenAddressOrEth].value, currencyDecimalsCache[tokenAddressOrEth]];
}

export default getCurrencyEthPriceAndDecimals;