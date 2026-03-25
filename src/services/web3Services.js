import https from "https";

const RPC_URL = process.env.ETHEREUM_RPC_URL;

function rpcCall(method, params = []) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      jsonrpc: "2.0", id: 1, method, params,
    });

    const url = new URL(RPC_URL);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: "POST",
      headers: {
        "Content-Type":   "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) reject(new Error(parsed.error.message));
          else resolve(parsed.result);
        } catch { reject(new Error("Invalid RPC response")); }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

export async function getTransactionReceipt(txHash) {
  return rpcCall("eth_getTransactionReceipt", [txHash]);
}

export async function getTransaction(txHash) {
  // ← Nom correct de la méthode
  return rpcCall("eth_getTransactionByHash", [txHash]);
}

export async function verifyEscrowTransaction(txHash, expectedToAddress, minAmountEth) {
  console.log("Verifying tx:", txHash);

  const [tx, receipt] = await Promise.all([
    getTransaction(txHash),
    getTransactionReceipt(txHash),
  ]);

  console.log("TX:", tx);
  console.log("Receipt:", receipt);

  if (!tx) throw new Error("Transaction not found on chain");
  if (!receipt) throw new Error("Transaction not yet confirmed");
  if (receipt.status !== "0x1") throw new Error("Transaction failed on-chain");

  const toAddress = tx.to?.toLowerCase();
  const expected  = expectedToAddress.toLowerCase();
  if (toAddress !== expected) {
    throw new Error(`Wrong destination: got ${toAddress}, expected ${expected}`);
  }

  const valueWei = BigInt(tx.value);
  const minWei   = BigInt(Math.round(minAmountEth * 1e18 * 0.98)); // tolérance 2%
  if (valueWei < minWei) {
    throw new Error(`Insufficient: sent ${Number(valueWei)/1e18} ETH, need ${minAmountEth} ETH`);
  }

  return {
    from:        tx.from,
    to:          tx.to,
    valueEth:    Number(valueWei) / 1e18,
    blockNumber: parseInt(receipt.blockNumber, 16),
    confirmed:   true,
  };
}