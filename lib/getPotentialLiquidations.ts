import { getPotentialLiquidation } from ".";

const Web3 = require("web3");

const getPotentialLiquidations = async ({ fusePoolDirectory, fuseSafeLiquidator, web3 }) => {
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
                var liquidation = await getPotentialLiquidation({ borrower: users[i][j], closeFactor: closeFactors[i], liquidationIncentive: liquidationIncentives[i], fuseSafeLiquidator: fuseSafeLiquidator, web3: web3 });
                if (liquidation !== null) liquidations.push(liquidation);
            }

            if (liquidations.length > 0) pools[comptrollers[i]] = liquidations;
        }
    }

    // * Get potential liquidations from supported pools (excluding the public pools that have already been checked)
    if (process.env.SUPPORTED_POOL_COMPTROLLERS && process.env.SUPPORTED_POOL_COMPTROLLERS.length > 0) {
        var potentialComptrollers = process.env.SUPPORTED_POOL_COMPTROLLERS.split(",");
        var new_comptrollers = [];

        if(potentialComptrollers) {
            for (const comptroller of potentialComptrollers) {
                if (new_comptrollers && !pools[new_comptrollers[i]]) new_comptrollers.push(comptroller);
            }

            var data = await fusePoolDirectory.methods.getPoolUsersWithData(new_comptrollers, Web3.utils.toBN(1e18)).call();
            var users = data["0"];
            var closeFactors = data["1"];
            var liquidationIncentives = data["2"];

            if(new_comptrollers) {
                for (var i = 0; i < new_comptrollers.length; i++) {
                    users[i].sort((a, b) => parseInt(b.totalBorrow) - parseInt(a.totalBorrow));
                    var new_liquidations = [];

                    for (var j = 0; j < users[i].length; j++) {
                        var liquidation = await getPotentialLiquidation({ borrower: users[i][j], closeFactor: closeFactors[i], liquidationIncentive: liquidationIncentives[i], fuseSafeLiquidator: fuseSafeLiquidator, web3: web3 });
                        if (liquidation !== null) new_liquidations.push(liquidation);
                    }

                    if (new_liquidations.length > 0) pools[new_comptrollers[i]] = new_liquidations;
                }
            }
        }
    }

    return pools;
}

export default getPotentialLiquidations;