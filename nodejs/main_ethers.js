const ethers = require("ethers");
const WebSocket = require("ws");
const axios = require("axios");
const readline = require("readline");

const BATCH_SIZE = 1;
const BATCH_TIME = 100000;
const INTERVAL = 1 * 1000; // 1s

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
  gasPrice,
  maxFeePerGas,
  maxPriorityFeePerGas,
  data
) {
  let provider = null;
  let isHttp = true;
  if (rpc.indexOf("https://") === 0) {
    provider = new ethers.providers.JsonRpcProvider(rpc);
    // provider = new ethers.providers.JsonRpcBatchProvider(rpc);
  } else {
    // new web3 with ws provider
    isHttp = false;
    provider = new ethers.providers.WebsocketProvider(rpc);
    ws = await createOpenPromise(rpc);
  }

  let chain_id;
  try {
    chain_id = (await provider.getNetwork()).chainId;
    console.log(`chain_id: ${chain_id}`)
  } catch (err) {
    console.log("can not get chain id");
    console.log(err);
    return;
  }

  // ethers to account
  const account = new ethers.Wallet(private_key);

  console.log("getting nonce...");
  let nonce = await provider.getTransactionCount(account.address);
  const gasPriceWei = ethers.utils.parseUnits(gasPrice.toString(), "gwei");
  // const maxFeePerGasWei = web3.utils.toWei(maxFeePerGas.toString(), 'gwei');
  const maxPriorityFeePerGasWei = ethers.utils.parseUnits(
    maxPriorityFeePerGas.toString(),
    "gwei"
  );

  const tx = {
    from: account.address,
    to: account.address, // mint to self
    nonce: nonce,
    gasLimit: 30000,
    gasPrice: gasPriceWei,
    // maxFeePerGas: maxFeePerGasWei,
    maxPriorityFeePerGas: maxPriorityFeePerGasWei, // only set maxPriorityFeePerGas
    chainId: chain_id,
    data: data,
  };

  if (gasPrice === 0) {
    delete tx.gasPrice;
  } else {
    delete tx.maxFeePerGas;
    delete tx.maxPriorityFeePerGas;
  }

  const match = data.match(/\[(\d+)-(\d+)\]/);
  let start, end, subtext;
  if (match) {
    start = parseInt(match[1]);
    end = parseInt(match[2]);
    subtext = match[0];
  } else {
    start = 0;
    end = 0;
    subtext = null;
  }

  // const time = (end - start) / 100 + 1 > 10000 ? (end - start) / 100 + 1 : 100;

  if (!data.startsWith("0x") && subtext === null) {
    data = web3.utils.asciiToHex(data);
  }

  for (let x = 0; x < BATCH_TIME; x++) {
    const request_list = [];
    for (let i = 0; i < BATCH_SIZE; i++) {
      tx.nonce = nonce;
      if (subtext !== null) {
        tx.data = data.replace(subtext, start.toString());
        start += 1;
        if (start > end) {
          console.log("已经到达最大范围");
          return;
        }
      }
      const signed = await account.signTransaction(tx);
      nonce += 1;
      request_list.push({
        jsonrpc: "2.0",
        method: "eth_sendRawTransaction",
        params: [signed.rawTransaction],
        id: nonce + 1,
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
      console.log(`sleep ${INTERVAL / 1000}s`);
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
  const _eip1559 = await getInput(
    "输入是否EIP1559(1为是，0为否)：",
    (eip1559) => ["0", "1"].includes(eip1559),
    "输入错误, 必须为0或1, 请检查后重新输入"
  );

  let _gasPrice, _maxFeePerGas, _maxPriorityFeePerGas;
  if (_eip1559 === "1") {
    _gasPrice = 0;
    // _maxFeePerGas = await getInput('输入maxFeePerGas：', maxFeePerGas => parseFloat(maxFeePerGas) > 0, 'maxFeePerGas必须大于0, 请检查后重新输入');
    _maxPriorityFeePerGas = await getInput(
      "输入maxPriorityFeePerGas：",
      (maxPriorityFeePerGas) => true,
      "maxPriorityFeePerGas必须大于0, 请检查后重新输入"
    );
  } else {
    _gasPrice = await getInput(
      "输入gasPrice：",
      (gasPrice) => parseFloat(gasPrice) > 0,
      "gasPrice必须大于0, 请检查后重新输入"
    );
    _maxFeePerGas = 0;
    _maxPriorityFeePerGas = 0;
  }

  const _data = await getInput(
    "输入data，0x开头的16进制数字:",
    (data) => data.length > 0,
    "data不能为空, 请检查后重新输入"
  );

  await mint(
    _rpc,
    _private_key,
    _gasPrice,
    _maxFeePerGas,
    _maxPriorityFeePerGas,
    _data
  );
}

async function test() {
  const _rpc = await getInput(
    "输入RPC：",
    (rpc) => rpc.startsWith("https://") || rpc.startsWith("wss://"),
    "RPC格式不对, 请检查后重新输入"
  );

  await mint(
    _rpc,
  );
}

main()
  .then(() => {
    rl.close();
  })
  .catch((err) => {
    console.log(err);
    rl.close();
  });
