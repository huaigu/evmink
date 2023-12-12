const Web3 = require("web3");
const WebSocket = require("ws");
const axios = require("axios");
const readline = require("readline");

const BATCH_SIZE = 30;
const BATCH_TIME = 10;
const INTERVAL = 60000; // 20s

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// 创建一个 Promise，用于在连接打开时进行 resolve
function createOpenPromise(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);

    ws.on("open", () => {
      resolve(ws);
    });

    ws.on("message", (data) => {
      res = JSON.parse(data);
      if (res.result != null) {
        console.log(`Subscription: ${res.result}`);
      } else if (res.params != null && res.params["result"] != null) {
        console.log(`New pending transaction: ${res.params["result"]}`);
      } else {
        console.log(`Unexpected: ${data}`);
      }
    });

    ws.on("error", (error) => {
      reject(error);
    });
  });
}

async function mint(
  rpc,
  private_key,
) {
  let web3 = null;
  let ws = null;
  let isHttp = true;
  if (rpc.indexOf("https://") === 0) {
    web3 = new Web3(rpc);
  } else {
    // new web3 with ws provider
    isHttp = false;
    web3 = new Web3(new Web3.providers.WebsocketProvider(rpc));
    ws = await createOpenPromise(rpc);
  }

  const account = web3.eth.accounts.privateKeyToAccount(private_key);
  const chain_id = await web3.eth.getChainId();
  let nonce = await web3.eth.getTransactionCount(account.address);
  console.log(nonce)
  const tx = {
    from: account.address,
    to: "0xd45f35D17F67FdFd9f73a9cd248A16a8A38f683C", // mint to self
    nonce: nonce,
    gas: 200000,
    // convert _value to wei
    value: web3.utils.toWei("0.002", "ether"),
    gasPrice: web3.utils.toWei('0.0000000032'),
    chainId: chain_id,
  };

  for (let x = 0; x < BATCH_TIME; x++) {
    const request_list = [];
    for (let i = 0; i < BATCH_SIZE; i++) {
      tx.nonce = nonce;
      const signed = await account.signTransaction(tx);
      nonce += 1;
      request_list.push({
        jsonrpc: "2.0",
        method: "eth_sendRawTransaction",
        params: [signed.rawTransaction],
        id: nonce,
      });
    }

    async function sendBatchRequest(rpc, request_list) {
      try {
        const res = await axios.post(rpc, (json = request_list));
        console.log("batch send.. done");
        // Process the response if needed
        // console.log(res.data);
      } catch (error) {
        console.error("Error sending batch request:", error);
      }
    }

    if (!isHttp) {
      ws.send(JSON.stringify(request_list));
    } else {
      await sendBatchRequest(rpc, request_list);
      console.log(`sleep ${INTERVAL / 1000}s`)
      await new Promise((resolve) => setTimeout(resolve, INTERVAL));
    }
  }
}

function getInput(prompt, check, error_msg) {
  return new Promise((resolve, reject) => {
    rl.question(prompt, (data) => {
      if (check(data)) {
        resolve(data.trim());
      } else {
        console.log(error_msg);
        reject();
      }
    });
  });
}

async function main() {
  // const _to = await getInput('输入地址(打到那个号)：', addr => addr.length === 42, '地址长度不对, 请检查后重新输入');
  const _private_key = await getInput(
    "输入私钥(有gas的小号)：",
    (key) => key.length === 64 || (key.startsWith("0x") && key.length === 66),
    "私钥长度不对, 请检查后重新输入"
  );

  const _rpc = await getInput(
    "输入RPC：",
    (rpc) => rpc.startsWith("https://") || rpc.startsWith("wss://"),
    "RPC格式不对, 请检查后重新输入"
  );

  await mint(
    _rpc,
    _private_key
  );
}

main()
  .then(() => {
    rl.close();
  })
  .catch(() => {
    rl.close();
  });
