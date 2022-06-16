import { Fuse } from '@midas-capital/sdk';
import { JsonRpcProvider } from '@ethersproject/providers';

const setUpSdk = (chainId: number, provider: JsonRpcProvider) => {
  return new Fuse(provider, chainId);
};

export default setUpSdk;
