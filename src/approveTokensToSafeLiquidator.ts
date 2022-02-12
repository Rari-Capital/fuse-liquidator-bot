import { BigNumber, constants, Contract } from 'ethers';
import { ERC20Abi } from '@midas-capital/sdk';
import { JsonRpcProvider, TransactionRequest, TransactionResponse } from '@ethersproject/providers';
import { fetchGasLimitForTransaction } from './utils';
import { setUpSdk } from './index';

export default async function approveTokensToSafeLiquidator(
  chainId: number,
  provider: JsonRpcProvider,
  erc20Address: string
) {
  const fuse = setUpSdk(chainId, provider);
  // Build data
  const signer = await fuse.provider.getSigner(process.env.ETHEREUM_ADMIN_ACCOUNT);
  let token = new Contract(erc20Address, ERC20Abi, signer);

  token = await token.connect(signer);
  const txCount = await fuse.provider.getTransactionCount(process.env.ETHEREUM_ADMIN_ACCOUNT!);

  let data = token.interface.encodeFunctionData('approve', [
    fuse.contracts.FuseSafeLiquidator.address,
    constants.MaxUint256,
  ]);

  // Build transaction
  const tx = {
    from: process.env.ETHEREUM_ADMIN_ACCOUNT,
    to: erc20Address,
    value: BigNumber.from(0),
    data: data,
    nonce: txCount,
  };
  const gasLimit = await fetchGasLimitForTransaction(fuse, 'approve', tx);
  const txRequest: TransactionRequest = {
    ...tx,
    gasLimit: gasLimit,
  };

  if (process.env.NODE_ENV !== 'production')
    console.log('Signing and sending approval transaction for: ' + erc20Address);

  // send transaction
  let sentTx: TransactionResponse;
  try {
    sentTx = await signer.sendTransaction(txRequest);
    await sentTx.wait();
  } catch (error) {
    throw 'Error sending ' + erc20Address + ' approval transaction: ' + error;
  }
  console.log('Successfully sent approval transaction for: ' + erc20Address);
  return sentTx;
}
