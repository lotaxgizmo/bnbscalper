// file: wsAuthFinal.js
import WebSocket from "ws";
import crypto from "crypto";

const API_KEY = "kg5U9wOpoV1CuwJAss";
const API_SECRET = "K1IEvO9msnP20xz8m3x2rKs045GDiRNZQcrY";

const WS_URL = "wss://stream-testnet.bybit.com/v5/private";

function signWs(secret, preSign) {
  return crypto.createHmac("sha256", secret).update(preSign).digest("hex");
}

const ws = new WebSocket(WS_URL);

ws.on("open", () => {
  console.log("✅ Connected, sending REAL auth (apiKey+recvWindow+timestamp)...");

  const timestamp = Date.now().toString();
  const recvWindow = "5000";

  const preSign = API_KEY + recvWindow + timestamp; // 👈 correct order from SDK
  const sign = signWs(API_SECRET, preSign);

  const authMsg = {
    op: "auth",
    args: [API_KEY, timestamp, recvWindow, sign],
  };

  console.log("Auth Payload:", authMsg);
  ws.send(JSON.stringify(authMsg));
});

ws.on("message", (raw) => {
  console.log("📩 Message:", raw.toString());
});
