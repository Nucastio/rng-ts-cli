import ora from "ora";
import chalk from "chalk";
import inquirer from "inquirer";
import { RNG } from "rng-ts-lib";

export const networkData: Record<
  number,
  {
    name: string;
    blockfrostURL: string;
  }
> = {
  0: {
    name: "Preprod",
    blockfrostURL: "https://cardano-preprod.blockfrost.io/api/v0",
  },
  1: {
    name: "Mainnet",
    blockfrostURL: "https://cardano-mainnet.blockfrost.io/api/v0",
  },
};

const baseParams = await inquirer.prompt([
  {
    name: "network",
    message: "Which network ? \n Type 1 for Mainnet \n Type 0 for Preprod",
    type: "input",
  },
  {
    name: "blockfrostApiKey",
    message: "Enter Blockfrost api key:",
    type: "input",
  },
  {
    name: "rngAPIURL",
    message: "Enter the hosted RNG API URL:",
    type: "input",
  },
  { name: "ogmiosURL", message: "Enter the hosted Ogmios URL:", type: "input" },
  {
    name: "oracleCBOR",
    message: "Enter Oracle Contract compiled CBOR:",
    type: "input",
  },
  {
    name: "rngCBOR",
    message: "Enter RNG Contract compiled CBOR:",
    type: "input",
  },
  {
    name: "walletSeed",
    message:
      "Enter 12, 15 or 24 words wallet seed (should have atleast 5-10 ADA) to perform actions:",
    type: "input",
  },
  {
    name: "rngOutputLen",
    message: "Enter your desired Random Number length:",
    type: "input",
  },
]);

let BASE_ORACLEDID: {
  unit: string;
  registered: boolean;
} | null = null;

let CURR_ORACLE_UPDATED_TX: string | null = null;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const instance = new RNG({
  blockfrostApiKey: baseParams.blockfrostApiKey.trim(),
  network: parseInt(baseParams.network.trim()) as 0 | 1,
  ogmiosURL: baseParams.ogmiosURL.trim(),
  oracleCBOR: baseParams.oracleCBOR.trim(),
  rngAPIURL: baseParams.rngAPIURL.trim(),
  rngCBOR: baseParams.rngCBOR.trim(),
  walletSeed: baseParams.walletSeed.trim(),
  rngOutputLen: parseInt(baseParams.rngOutputLen),
});

console.log(chalk.greenBright("Creating Oracle DID for you"));

const oracleNameParam = await inquirer.prompt([
  {
    name: "oracleDIDName",
    message: "Enter your desired name for Oracle DID:",
    type: "input",
  },
]);

const mintingOracle = ora("Minting Oracle DID to your wallet").start();

const { data: oracleMintData, error: oracleMintError } =
  await instance.oracle.mint(oracleNameParam.oracleDIDName);

if (!oracleMintData?.txHash) throw Error(JSON.stringify(oracleMintError));

mintingOracle.stop();

const onChainingMintingOracle = ora(
  `Waiting for transaction: ${oracleMintData.txHash.slice(
    0,
    6
  )}... to be confirmed`
).start();

await sleep(120 * 1000);

onChainingMintingOracle.stop();

BASE_ORACLEDID = { unit: oracleMintData.oracleDIDUnit, registered: false };

console.log(
  chalk.greenBright(
    "To register the Oracle DID, We need initial RNG transaction to pass the data with it"
  )
);

const { data: rngInitData, error: rngInitError } = await instance.init();

if (!rngInitData) throw Error(rngInitError);

const mintingRNG = ora(
  `Initiated RNG ID to RNG Contract: ${rngInitData.txHash.slice(0, 6)}...`
).start();

await sleep(120 * 1000);

mintingRNG.stop();

const registeringOracle = ora(
  "Registering Oracle DID to Oracle Contract"
).start();

const { data: oracleRegisterData, error: oracleRegisterError } =
  await instance.oracle.register({
    initRNGTx: rngInitData.txHash,
    oracleDIDUnit: BASE_ORACLEDID.unit,
  });

if (!oracleRegisterData?.txHash) throw Error(oracleRegisterError);

await sleep(120 * 1000);

registeringOracle.stop();

CURR_ORACLE_UPDATED_TX = oracleRegisterData.txHash;

BASE_ORACLEDID = {
  registered: true,
  unit: BASE_ORACLEDID.unit,
};

while (true) {
  const GenerationActions = await inquirer.prompt([
    {
      name: "actionType",
      message:
        "Following actions you can do with\n 1. Generate new RNG\n 2. Query Oracle DID",
      type: "input",
    },
  ]);

  const choice = parseInt(GenerationActions.actionType);

  if (choice === 1 && CURR_ORACLE_UPDATED_TX) {
    const rngOutputLenParam = await inquirer.prompt([
      {
        name: "rngOutputLen",
        message: "Enter your desired Random Number length:",
        type: "input",
      },
    ]);

    instance.updateConfig(
      "rngOutputLen",
      parseInt(rngOutputLenParam.rngOutputLen)
    );

    const { data: promptRngInitData, error: promptRngInitError } =
      await instance.init();

    if (!promptRngInitData) throw Error(promptRngInitError);

    const mintingRNG = ora(
      `Initiated RNG ID to RNG Contract: ${promptRngInitData.txHash.slice(
        0,
        6
      )}...`
    ).start();

    await sleep(120 * 1000);

    mintingRNG.stop();

    const updatingOracle = ora(
      "Updating Oracle DID to Oracle Contract"
    ).start();

    const { data: updateData, error: oracleUpdateError } =
      await instance.oracle.update({
        initRNGTx: promptRngInitData.txHash,
        oracleDIDUnit: BASE_ORACLEDID.unit,
        currUpdatedOracleDIDTx: CURR_ORACLE_UPDATED_TX,
      });

    if (!updateData?.txHash) throw Error(oracleUpdateError);

    await sleep(120 * 1000);

    updatingOracle.stop();

    CURR_ORACLE_UPDATED_TX = updateData.txHash;
  }

  if (choice === 2 && CURR_ORACLE_UPDATED_TX) {
    const { data } = await instance.oracle.query(CURR_ORACLE_UPDATED_TX);

    console.log(
      chalk.greenBright(`Random Number from Oracle: ${data?.rngOutput}`)
    );
  }
}
