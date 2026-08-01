import { BrowserProvider } from "ethers";

export type ConnectedWallet = {
  address: string;
  short: string;
};

function shorten(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function getEthereum() {
  const eth = (window as Window & { ethereum?: unknown }).ethereum;
  if (!eth || typeof eth !== "object") return null;
  return eth as ConstructorParameters<typeof BrowserProvider>[0];
}

export async function connectWallet(): Promise<ConnectedWallet> {
  const ethereum = getEthereum();
  if (!ethereum) {
    throw new Error("No wallet found. Install MetaMask or another browser wallet.");
  }
  const provider = new BrowserProvider(ethereum);
  await provider.send("eth_requestAccounts", []);
  const signer = await provider.getSigner();
  const address = await signer.getAddress();
  return { address, short: shorten(address) };
}

export async function signEnrollMessage(guildName: string): Promise<{
  address: string;
  short: string;
  message: string;
  signature: string;
}> {
  const ethereum = getEthereum();
  if (!ethereum) {
    throw new Error("No wallet found. Install MetaMask or another browser wallet.");
  }
  const provider = new BrowserProvider(ethereum);
  await provider.send("eth_requestAccounts", []);
  const signer = await provider.getSigner();
  const address = await signer.getAddress();
  const message = [
    "Arb Guardian guild enroll",
    `Guild: ${guildName.trim().slice(0, 48) || "Guild"}`,
    `Officer: ${address}`,
    `Issued: ${new Date().toISOString()}`
  ].join("\n");
  const signature = await signer.signMessage(message);
  return { address, short: shorten(address), message, signature };
}

export function shortAddress(address: string) {
  if (!address || address.length < 10) return address;
  return shorten(address);
}
