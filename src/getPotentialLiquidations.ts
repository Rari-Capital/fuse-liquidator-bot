import { FusePoolUser, Pool } from './utils';
import { BigNumber, utils } from 'ethers';
import { Fuse } from '@midas-capital/sdk';
import { gatherLiquidations } from './index';

export default async function getPotentialLiquidations(fuse: Fuse): Promise<Pool> {
  let pools: Pool = {};

  let comptrollers;
  let data;
  let users;
  let closeFactors;
  let liquidationIncentives;

  // Get potential liquidations from public pools
  if (process.env.SUPPORT_ALL_PUBLIC_POOLS) {
    data = await fuse.contracts.FusePoolLens.callStatic.getPublicPoolUsersWithData(
      utils.parseEther('1')
    );
    comptrollers = data['0'] as Array<string>;
    users = data['1'] as Array<Array<FusePoolUser>>;
    closeFactors = data['2'] as Array<BigNumber>;
    liquidationIncentives = data['3'] as Array<BigNumber>;
    pools = await gatherLiquidations(
      fuse,
      comptrollers,
      users,
      closeFactors,
      liquidationIncentives,
      pools
    );
  }

  // Get potential liquidations from supported pools (excluding the public pools that have already been checked)
  if (process.env.SUPPORTED_POOL_COMPTROLLERS!.length > 0) {
    comptrollers = [];
    const potentialComptrollers = process.env.SUPPORTED_POOL_COMPTROLLERS!.split(',');
    for (const comptroller of potentialComptrollers) {
      if (!pools[comptroller]) {
        comptrollers.push(comptroller);
      }
    }

    data = await fuse.contracts.FusePoolLens.callStatic.getPoolUsersWithData(
      comptrollers,
      utils.parseEther('1')
    );
    users = data['0'];
    closeFactors = data['1'];
    liquidationIncentives = data['2'];
    pools = await gatherLiquidations(
      fuse,
      comptrollers,
      users,
      closeFactors,
      liquidationIncentives,
      pools
    );
  }

  return pools;
}
