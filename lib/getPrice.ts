const axios = require("axios");

const getPrice = async (tokenAddress) => {
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

export default getPrice;