import { NextResponse } from "next/server";

async function getPusherAuthSignature(socketId: string, channelName: string, appSecret: string, appKey: string) {
  const stringToSign = `${socketId}:${channelName}`;
  const encoder = new TextEncoder();
  const keyData = encoder.encode(appSecret);
  const msgData = encoder.encode(stringToSign);

  const cryptoKey = await crypto.subtle.importKey(
    "raw", 
    keyData, 
    { name: "HMAC", hash: "SHA-256" }, 
    false, 
    ["sign"]
  );

  const signatureBuffer = await crypto.subtle.sign("HMAC", cryptoKey, msgData);
  const signatureArray = Array.from(new Uint8Array(signatureBuffer));
  const signatureHex = signatureArray.map(b => b.toString(16).padStart(2, '0')).join('');

  return `${appKey}:${signatureHex}`;
}

export async function POST(request: Request) {
  const PUSHER_APP_KEY = "bc4bbe143420c20c0e9d";
  const PUSHER_SECRET = "bbd18207d17c2f39529e"; 

  try {
    const bodyText = await request.text();
    const params = new URLSearchParams(bodyText);
    const socketId = params.get("socket_id");
    const channelName = params.get("channel_name");
      
    if (!socketId || !channelName) {
      return NextResponse.json({ error: "Missing socket_id or channel_name" }, { status: 400 });
    }
      
    const authSignature = await getPusherAuthSignature(socketId, channelName, PUSHER_SECRET, PUSHER_APP_KEY);
    return NextResponse.json({ auth: authSignature });
  } catch (error) {
    console.error("Auth error:", error);
    return NextResponse.json(
      { error: "Authentication pipeline failed" }, 
      { status: 500 }
    );
  }
}
