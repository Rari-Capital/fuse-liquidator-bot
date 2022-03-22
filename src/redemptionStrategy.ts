import { Fuse } from '@midas-capital/sdk';
import { BytesLike, Contract, ethers } from 'ethers';

type TokenToStrategy = {
  [chainId: number]: {
    [token: string]: string;
  };
};

export type StrategyAndData = {
  strategyAddress: string[];
  strategyData: BytesLike[];
};

enum RedemptionStrategy {
  CurveLpTokenLiquidatorNoRegistry = 'CurveLpTokenLiquidatorNoRegistry',
  XBombLiquidator = 'XBombLiquidator',
  jBRLLiquidator = 'jBRLLiquidator',
}

const tokenToStrategyMapping: TokenToStrategy = {
  56: {
    '0x -- EPSTOKEN': RedemptionStrategy.CurveLpTokenLiquidatorNoRegistry,
    '0x -- BOMB': RedemptionStrategy.XBombLiquidator,
    '0x -- jBRL': RedemptionStrategy.jBRLLiquidator,
  },
  9001: {
    '0x -- Kinesis': RedemptionStrategy.CurveLpTokenLiquidatorNoRegistry,
  },
};

export const requiresCustomStrategy = (chainId: number, token: string) => {
  return token in tokenToStrategyMapping[chainId];
};

export const getStrategyAndData = async (fuse: Fuse, token: string): Promise<StrategyAndData> => {
  const { chainId } = await fuse.provider.getNetwork();
  if (!requiresCustomStrategy(chainId, token)) return { strategyData: [], strategyAddress: [] };

  const redemptionStrategy = tokenToStrategyMapping[chainId][token] as RedemptionStrategy;
  const redemptionStrategyContract = new Contract(
    fuse.chainDeployment[redemptionStrategy].address,
    fuse.chainDeployment[redemptionStrategy].abi,
    fuse.provider
  );
  let strategyAndData = { strategyAddress: [redemptionStrategyContract.address] };

  switch (redemptionStrategy) {
    case RedemptionStrategy.CurveLpTokenLiquidatorNoRegistry:
      const curveLpOracleAddress = await redemptionStrategyContract.callStatic.oracle();
      const curveLpOracle = new Contract(
        curveLpOracleAddress,
        fuse.chainDeployment.CurveLpTokenPriceOracleNoRegistry.abi,
        fuse.provider
      );
      const tokens = await curveLpOracle.callStatic.underlyingTokens(token);
      return {
        ...strategyAndData,
        strategyData: [new ethers.utils.AbiCoder().encode(['uint256', 'address'], [0, tokens[0]])],
      };

    case RedemptionStrategy.XBombLiquidator: {
      return { ...strategyAndData, strategyData: [] };
    }
    case RedemptionStrategy.jBRLLiquidator: {
      return { ...strategyAndData, strategyData: [] };
    }
    default: {
      return { ...strategyAndData, strategyData: [] };
    }
  }
};
