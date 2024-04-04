require('dotenv').config()
const{
	Transaction, Connection, Keypair
} = require('@solana/web3.js')
const {
	Wallet
} = require('@coral-xyz/anchor')
const bs58 = require('bs58')
const axios = require('axios')
const {
	jsonInfo2PoolKeys, TOKEN_PROGRAM_ID, SPL_ACCOUNT_LAYOUT, Liquidity, Token, TokenAmount, Percent
} = require('@raydium-io/raydium-sdk')

async function getOwnerTokenAccounts(connection, wallet) {
	const walletTokenAccount = await connection.getTokenAccountsByOwner(wallet.publicKey, {
		programId: TOKEN_PROGRAM_ID
	})

	return walletTokenAccount.value.map((i) => ({
		pubkey: i.pubkey,
		programId: i.account.owner,
		accountInfo: SPL_ACCOUNT_LAYOUT.decode(i.account.data)
	}))
}

async function calcAmountOut(poolKeys, rawAmountIn, swapInDirection, connection) {
	const poolInfo = await Liquidity.fetchInfo({
		connection: connection,
		poolKeys 
	})

	let currencyInMint = poolKeys.baseMint

	let currencyInDecimals = poolInfo.baseDecimals

	let currencyOutMint = poolKeys.quoteMint

	let currencyOutDecimals = poolInfo.quoteDecimals

	if (!swapInDirection) {
		currencyInMint = poolKeys.quoteMint
		currencyInDecimals = poolInfo.quoteDecimals
		currencyOutMint = poolKeys.baseMint
		currencyOutDecimals = poolInfo.baseDecimals
	}

	const currencyIn = new Token(TOKEN_PROGRAM_ID, currencyInMint, currencyInDecimals)

	const amountIn = new TokenAmount(currencyIn, rawAmountIn, false)

	const currencyOut = new Token(TOKEN_PROGRAM_ID, currencyOutMint, currencyOutDecimals)

	const slippage = new Percent(5, 100) // 5% slippage

	const {
		amountOut, minAmountOut, currentPrice, executionPrice, priceImpact, fee 
	} = Liquidity.computeAmountOut({
		poolKeys,
		poolInfo,
		amountIn,
		currencyOut,
		slippage
	})

	return {
		amountIn,
		amountOut,
		minAmountOut,
		currentPrice,
		executionPrice,
		priceImpact,
		fee
	}
}

async function getSwapTransaction(
	toToken,
	amount,
	poolKeys,
	maxLamports,
	fixedSide,
	connection,
	wallet
) {

	const directionIn = poolKeys.quoteMint.toString() === toToken

	const {
		minAmountOut, amountIn 
	} = await calcAmountOut(poolKeys, amount, directionIn, connection)

	const userTokenAccounts = await getOwnerTokenAccounts(connection, wallet)

	const swapTransaction = await Liquidity.makeSwapInstructionSimple({
		connection: connection,
		makeTxVersion: 0,
		poolKeys: {
			...poolKeys
		},
		userKeys: {
			tokenAccounts: userTokenAccounts,
			owner: wallet.publicKey
		},
		amountIn: amountIn,
		amountOut: minAmountOut,
		fixedSide: fixedSide,
		config: {
			bypassAssociatedCheck: false
		},
		computeBudgetConfig: {
			microLamports: maxLamports
		},
	})

	const recentBlockhashForSwap = await connection.getLatestBlockhash()

	const instructions = swapTransaction.innerTransactions[0].instructions.filter(Boolean)

	const legacyTransaction = new Transaction({
		blockhash: recentBlockhashForSwap.blockhash,
		lastValidBlockHeight: recentBlockhashForSwap.lastValidBlockHeight,
		feePayer: wallet.publicKey
	})

	legacyTransaction.add(...instructions)

	return legacyTransaction
}

async function swap() {
	const connection = new Connection(process.env.RPC_ENDPOINT, {
		commitment: 'confirmed' 
	})

	const wallet = new Wallet(Keypair.fromSecretKey(Uint8Array.from(bs58.decode(process.env.PRIVATE_KEY))))

	const liquidityJsonResp = await axios('https://api.raydium.io/v2/sdk/liquidity/mainnet.json')

	const liquidityJson = (liquidityJsonResp.data)

	const allPoolKeysJson =  [...(liquidityJson.official ?? []), ...(liquidityJson.unOfficial ?? [])]

	const poolInfo =  jsonInfo2PoolKeys(allPoolKeysJson.find(
		(i) => (
			i.baseMint === process.argv[2] &&
			i.quoteMint === process.argv[3]) ||
			(
				i.baseMint === process.argv[3] &&
				i.quoteMint === process.argv[2]
			)
	))

	const tx = await getSwapTransaction(
		process.argv[3],
		process.argv[4],
		poolInfo,
		1500000,
		'in',
		connection,
		wallet
	)

	const txid = await connection.sendTransaction(tx, [wallet.payer], {
		skipPreflight: true,
		maxRetries: 20
	})

	console.log(`https://solscan.io/tx/${txid}`)

}

async function apeIn() {
	const connection = new Connection(process.env.RPC_ENDPOINT, {
		commitment: 'confirmed'
	})

	const wallet = new Wallet(Keypair.fromSecretKey(Uint8Array.from(bs58.decode(process.env.PRIVATE_KEY))))

	const liquidityJsonResp = await axios('https://api.raydium.io/v2/sdk/liquidity/mainnet.json')

	const liquidityJson = (liquidityJsonResp.data)

	const allPoolKeysJson =  [...(liquidityJson.official ?? []), ...(liquidityJson.unOfficial ?? [])]

	const poolInfo =  jsonInfo2PoolKeys(allPoolKeysJson.find(
		(i) => (
			i.baseMint === 'So11111111111111111111111111111111111111112' &&
				i.quoteMint === process.argv[3]) ||
			(
				i.baseMint === process.argv[3] &&
				i.quoteMint === 'So11111111111111111111111111111111111111112'
			)
	))

	const tx = await getSwapTransaction(
		process.argv[3],
		process.env.APE_IN_AMOUNT,
		poolInfo,
		1500000,
		'in',
		connection,
		wallet
	)

	const txid = await connection.sendTransaction(tx, [wallet.payer], {
		skipPreflight: true,
		maxRetries: 20
	})

	console.log(`https://solscan.io/tx/${txid}`)

}

async function sellAll() {
	const connection = new Connection(process.env.RPC_ENDPOINT, 'confirmed')
	const wallet = new Wallet(Keypair.fromSecretKey(Uint8Array.from(bs58.decode(process.env.PRIVATE_KEY))))
	const specifiedTokenMint = process.argv[3]

	const solMintAddress = 'So11111111111111111111111111111111111111112'

	const walletTokenAccounts = await getOwnerTokenAccounts(connection, wallet)
	const specifiedTokenAccount = walletTokenAccounts.find(account => account.accountInfo.mint.toBase58() === specifiedTokenMint)

	if (!specifiedTokenAccount) {
		console.error('Specified token account not found in wallet.')
		return
	}

	const amountToSwap = specifiedTokenAccount.accountInfo.amount

	const liquidityJsonResp = await axios('https://api.raydium.io/v2/sdk/liquidity/mainnet.json')
	const liquidityJson = liquidityJsonResp.data
	const allPoolKeysJson = [...(liquidityJson.official ?? []), ...(liquidityJson.unOfficial ?? [])]

	const poolInfo = jsonInfo2PoolKeys(allPoolKeysJson.find(pool =>
		(pool.baseMint === specifiedTokenMint && pool.quoteMint === solMintAddress) ||
		(pool.quoteMint === specifiedTokenMint && pool.baseMint === solMintAddress)
	))

	if (!poolInfo) {
		console.error('No liquidity pool found for specified token to SOL swap.')
		return
	}

	const tokenDecimals = specifiedTokenMint === poolInfo.baseMint.toString() ? poolInfo.baseDecimals : poolInfo.quoteDecimals

	const amountToSwapDecimal = amountToSwap / Math.pow(10, tokenDecimals)

	const tx = await getSwapTransaction(
		solMintAddress,
		amountToSwapDecimal,
		poolInfo,
		1500000,
		'out',
		connection,
		wallet
	)

	try {
		const txid = await connection.sendTransaction(tx, [wallet.payer], {
			skipPreflight: true,
			maxRetries: 20
		})
		console.log(`https://solscan.io/tx/${txid}`)
	} catch (error) {
		console.error(`Failed to swap specified token: ${error}`)
	}
}

if(process.argv[2] === 'sell-all') {
	sellAll()
} else if (process.argv[2] === 'ape-in') {
	apeIn()
}else{
	swap()
}

