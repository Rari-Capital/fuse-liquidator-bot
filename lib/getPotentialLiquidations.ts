const Web3 = require("web3");

const getPotentialLiquidations = async ({ fusePoolDirectory }) => {
    var pools = {};

    // * Get potential liquidations from public pools
    if (process.env.SUPPORT_ALL_PUBLIC_POOLS) {
        var data = await fusePoolDirectory.methods.getPublicPoolUsersWithData(Web3.utils.toBN(1e18)).call();
        var comptrollers = data["0"];
        var users = data["1"];
        var closeFactors = data["2"];
        var liquidationIncentives = data["3"];

        for (var i = 0; i < comptrollers.length; i++) {
            users[i].sort((a, b) => parseInt(b.totalBorrow) - parseInt(a.totalBorrow));
            var liquidations = [];

            for (var j = 0; j < users[i].length; j++) {
                var liquidation = await getPotentialLiquidation(users[i][j], closeFactors[i], liquidationIncentives[i]);
                if (liquidation !== null) liquidations.push(liquidation);
            }

            if (liquidations.length > 0) pools[comptrollers[i]] = liquidations;
        }
    }

    // * Get potential liquidations from supported pools (excluding the public pools that have already been checked)
    if (process.env.SUPPORTED_POOL_COMPTROLLERS.length > 0) {
        var potentialComptrollers = process.env.SUPPORTED_POOL_COMPTROLLERS.split(",");
        var comptrollers: any = [];
        for (const comptroller of potentialComptrollers) if (!pools[comptrollers[i]]) comptrollers.push(comptroller);

        var data = await fusePoolDirectory.methods.getPoolUsersWithData(comptrollers, Web3.utils.toBN(1e18)).call();
        var users = data["0"];
        var closeFactors = data["1"];
        var liquidationIncentives = data["2"];

        for (var i = 0; i < comptrollers.length; i++) {
            users[i].sort((a, b) => parseInt(b.totalBorrow) - parseInt(a.totalBorrow));
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

export default getPotentialLiquidations;