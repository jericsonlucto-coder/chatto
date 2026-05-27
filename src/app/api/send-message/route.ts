import { NextResponse } from "next/server";

// For Cloudflare Workers, we'll use fetch API directly to Pusher
const PUSHER_APP_ID = "YOUR_APP_ID";
const PUSHER_KEY = "YOUR_PUSHER_KEY";
const PUSHER_SECRET = "YOUR_PUSHER_SECRET";
const PUSHER_CLUSTER = "YOUR_CLUSTER";

export async function POST(request: Request) {
  try {
    const message = await request.json();

    // Construct the Pusher trigger URL
    const url = `https://api-${PUSHER_CLUSTER}.pusher.com/apps/${PUSHER_APP_ID}/events`;
    
    // Create auth signature
    const authKey = PUSHER_KEY;
    const authSecret = PUSHER_SECRET;
    
    const body = JSON.stringify({
      name: "new-message",
      channel: "chat-channel",
      data: JSON.stringify(message),
    });
    
    const timestamp = Math.floor(Date.now() / 1000);
    const stringToSign = `POST\n/apps/${PUSHER_APP_ID}/events\nauth_key=${authKey}&auth_timestamp=${timestamp}&auth_version=1.0&body_md5=${await getMD5(body)}`;
    
    // Simple crypto for Cloudflare
    const encoder = new TextEncoder();
    const keyData = encoder.encode(authSecret);
    const messageData = encoder.encode(stringToSign);
    
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      keyData,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    
    const signature = await crypto.subtle.sign("HMAC", cryptoKey, messageData);
    const authSignature = Array.from(new Uint8Array(signature))
      .map(b => b.toString(16).padStart(2, "0"))
      .join("");
    
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...JSON.parse(body),
        auth_key: authKey,
        auth_timestamp: timestamp,
        auth_version: "1.0",
        auth_signature: authSignature,
      }),
    });

    if (!response.ok) {
      throw new Error(`Pusher trigger failed: ${response.statusText}`);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error sending message:", error);
    return NextResponse.json(
      { error: "Failed to send message" },
      { status: 500 }
    );
  }
}

// Helper function to calculate MD5
async function getMD5(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);
  const hashBuffer = await crypto.subtle.digest("MD5", dataBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}
