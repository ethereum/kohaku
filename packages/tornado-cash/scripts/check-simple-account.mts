/** Local-only integration check. Contracts are read from external build artifacts;
 * no Solidity, bytecode, or contract dependencies are vendored in this package.
 * Checks factory deployment through EntryPoint and the actual account's validation
 * of the SDK signature, including the paymaster data. It does not test a pool proof.
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const req = createRequire(new URL('../package.json', import.meta.url));
const { createPublicClient, createWalletClient, http, parseEther, encodeFunctionData, toHex } = req('viem');
const { privateKeyToAccount } = req('viem/accounts');
const { entryPoint08Address, entryPoint08Abi, toPackedUserOperation, getUserOperationHash, getUserOperationTypedData } = req('viem/account-abstraction');
import { buildSignedTornadoUserOp } from '../src/paymaster/utils.ts';
import { externalAccountSigner, prepareExecutionAccount } from '../src/account/execution-account.ts';
const rpc = process.env.ACCOUNT_TEST_RPC;
const artifacts = process.env.ACCOUNT_TEST_ARTIFACTS;
const entryPointCreateCall = process.env.ACCOUNT_TEST_ENTRYPOINT_CREATECALL;
if (!rpc || !artifacts || !entryPointCreateCall) throw new Error('Set ACCOUNT_TEST_RPC (local Anvil), ACCOUNT_TEST_ARTIFACTS (external Foundry out/), and ACCOUNT_TEST_ENTRYPOINT_CREATECALL');
const endpoint = new URL(rpc);
if (!['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)) throw new Error('This check only sends transactions to a local Anvil node');
const client=createPublicClient({transport:http(rpc)});
const chainId=await client.getChainId();
const [deployer] = await client.request({method:'eth_accounts'});
const wallet=createWalletClient({transport:http(rpc),account:deployer});
const artifact=JSON.parse(readFileSync(`${artifacts}/SimpleAccountFactory.sol/SimpleAccountFactory.json`,'utf8'));
const createcall=readFileSync(entryPointCreateCall,'utf8').trim();
if (!(await client.getCode({address:entryPoint08Address}))) await client.waitForTransactionReceipt({hash:await wallet.sendTransaction({to:'0x4e59b44847b379578588920ca78fbf26c0b4956c',data:createcall,gas:15000000n,chain:null})});
assert((await client.getCode({address:entryPoint08Address}))?.length>2);
const receipt=await client.waitForTransactionReceipt({hash:await wallet.deployContract({abi:artifact.abi,bytecode:artifact.bytecode.object,args:[entryPoint08Address],gas:10000000n,chain:null})});
const factory=receipt.contractAddress;
assert(factory);
const owner=privateKeyToAccount('0x'+'09'.repeat(32));
const sender=await client.readContract({address:factory,abi:artifact.abi,functionName:'getAddress',args:[owner.address,0n]});
const signer=externalAccountSigner({mode:'smart-account',signer:{address:owner.address,signTypedData:owner.signTypedData},account:{kind:'simple-account',address:sender},nonce:0n});
const accountConfig = { mode: 'smart-account' as const, signer: { address: owner.address, signTypedData: owner.signTypedData }, account: { kind: 'simple-account' as const, address: sender, factory: { address: factory, salt: 0n } } };
const initial = await prepareExecutionAccount(accountConfig, signer, client, entryPoint08Address);
assert.equal(initial.nonce, 0n);
const op=await buildSignedTornadoUserOp({signer,executionAccount:{kind:'simple-account',address:sender,factory:{address:factory,salt:0n}},chainId,nonce:0n,paymasterAddress:'0x0000000000000000000000000000000000000044',paymasterData:'0x',gas:{callGasLimit:100000n,verificationGasLimit:500000n,preVerificationGas:100000n,paymasterVerificationGasLimit:100000n,paymasterPostOpGasLimit:50000n},maxFeePerGas:2000000000n,maxPriorityFeePerGas:1000000000n,tailCalls:async()=>[{to:deployer,value:1n,data:'0x'}]});
assert(!('eip7702Auth' in op));
// Exercise the exact factoryData supplied by the SDK through canonical EntryPoint.
await client.request({method:'anvil_setBalance',params:[sender,toHex(parseEther('2'))]});
const normalized=Object.fromEntries(Object.entries(op).filter(([k])=>!k.startsWith('paymaster')).map(([k,v])=>[k,/^(nonce|.*GasLimit|preVerificationGas|maxFeePerGas|maxPriorityFeePerGas)$/.test(k)?BigInt(v as string):v]));
normalized.signature=await owner.signTypedData(getUserOperationTypedData({chainId,entryPointAddress:entryPoint08Address,userOperation:normalized}));
const packed=toPackedUserOperation(normalized);
const hash=await wallet.writeContract({address:entryPoint08Address,abi:entryPoint08Abi,functionName:'handleOps',args:[[packed],deployer],gas:3000000n,chain:null});
const deployed=await client.waitForTransactionReceipt({hash});
assert.equal(deployed.status,'success');
assert((await client.getCode({address:sender}))?.length>2);
assert.equal(await client.readContract({address:sender,abi:[{type:'function',name:'owner',stateMutability:'view',inputs:[],outputs:[{type:'address'}]}],functionName:'owner'}),owner.address);
// Validate the original SDK signature, including its paymaster data, against upstream code.
const complete=Object.fromEntries(Object.entries(op).map(([k,v])=>[k,/^(nonce|.*GasLimit|preVerificationGas|maxFeePerGas|maxPriorityFeePerGas)$/.test(k)?BigInt(v as string):v]));
const accountAbi=[{type:'function',name:'validateUserOp',stateMutability:'nonpayable',inputs:[{name:'userOp',type:'tuple',components:entryPoint08Abi.find((f:any)=>f.name==='handleOps').inputs[0].components},{name:'userOpHash',type:'bytes32'},{name:'missingAccountFunds',type:'uint256'}],outputs:[{type:'uint256'}]}];
const result=await client.call({account:entryPoint08Address,to:sender,data:encodeFunctionData({abi:accountAbi,functionName:'validateUserOp',args:[toPackedUserOperation(complete),getUserOperationHash({chainId,entryPointAddress:entryPoint08Address,entryPointVersion:'0.8',userOperation:complete}),0n]})});
assert.equal(BigInt(result.data),0n);
await assert.rejects(prepareExecutionAccount(accountConfig, signer, client, entryPoint08Address), /allowUsed: true/);
const reused = await prepareExecutionAccount({ ...accountConfig, allowUsed: true }, signer, client, entryPoint08Address);
assert.equal(reused.nonce, 1n);
assert.equal(reused.account.kind === 'simple-account' && reused.account.factory, undefined);
console.log(JSON.stringify({chainId,entryPoint:entryPoint08Address,factory,sender,factoryUserOpStatus:deployed.status,originalSdkSignatureValidated:true,reuseGuardValidated:true}));
