import { NextResponse } from "next/server";

const PUSHER_APP_ID = "2159204";
const PUSHER_KEY = "bc4bbe143420c20c0e9d";
const PUSHER_SECRET = "bbd18207d17c2f39529e";
const PUSHER_CLUSTER = "ap1";

async function getSignature(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const msgData = encoder.encode(message);
  
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  
  const signatureBuffer = await crypto.subtle.sign("HMAC", cryptoKey, msgData);
  const signatureArray = Array.from(new Uint8Array(signatureBuffer));
  return signatureArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function POST(request: Request) {
  try {
    const { socket_id, channel_name } = await request.json();
    
    // Create the auth string
    const stringToSign = `${socket_id}:${channel_name}`;
    const signature = await getSignature(PUSHER_SECRET, stringToSign);
    
    const authData = {
      auth: `${PUSHER_KEY}:${signature}`,
    };
    
    // Add channel data if needed for presence channels
    if (channel_name.startsWith("presence-")) {
      // You can add user data here
      authData.channel_data = JSON.stringify({
        user_id: socket_id,
        user_info: {
          name: "User Name" // You can pass this from the client
        }
      });
    }
    
    return NextResponse.json(authData);
  } catch (error) {
    console.error("Auth error:", error);
    return NextResponse.json(
      { error: "Authentication failed" },
      { status: 400 }
    );
  }
}
