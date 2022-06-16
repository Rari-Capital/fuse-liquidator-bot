import { TransactionRequest } from '@ethersproject/providers';
import { Fuse } from '@midas-capital/sdk';

export async function fetchGasLimitForTransaction(
  fuse: Fuse,
  method: string,
  tx: TransactionRequest
) {
  try {
    return await fuse.provider.estimateGas(tx);
  } catch (error) {
    throw `Failed to estimate gas before signing and sending ${method} transaction: ${error}`;
  }
}
