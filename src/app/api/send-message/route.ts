import { NextResponse } from "next/server";

// Replace these with your actual Pusher credentials
const PUSHER_APP_ID = "YOUR_APP_ID";
const PUSHER_KEY = "YOUR_PUSHER_KEY";
const PUSHER_SECRET = "YOUR_PUSHER_SECRET";
const PUSHER_CLUSTER = "YOUR_CLUSTER";

export async function POST(request: Request) {
  try {
    const message = await request.json();
    
    // Create the payload for Pusher HTTP API
    const payload = {
      name: "new-message",
      channel: "chat-channel",
      data: JSON.stringify(message)
    };
    
    // Generate authentication signature
    const timestamp = Math.floor(Date.now() / 1000);
    const bodyString = JSON.stringify(payload);
    
    // Create signature string
    const path = `/apps/${PUSHER_APP_ID}/events`;
    const queryString = `auth_key=${PUSHER_KEY}&auth_timestamp=${timestamp}&auth_version=1.0&body_md5=${await md5(bodyString)}`;
    const stringToSign = `POST\n${path}\n${queryString}`;
    
    // Generate HMAC-SHA256 signature
    const signature = await hmacSha256(PUSHER_SECRET, stringToSign);
    
    // Make request to Pusher HTTP API
    const response = await fetch(`https://api-${PUSHER_CLUSTER}.pusher.com${path}?${queryString}&auth_signature=${signature}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: bodyString,
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error("Pusher API error:", errorText);
      return NextResponse.json(
        { error: `Pusher error: ${response.status}` },
        { status: response.status }
      );
    }
    
    const result = await response.json();
    return NextResponse.json({ success: true, result });
    
  } catch (error) {
    console.error("Error in API route:", error);
    return NextResponse.json(
      { error: "Failed to send message", details: error.message },
      { status: 500 }
    );
  }
}

// Helper function to calculate MD5 hash
async function md5(str: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest("MD5", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

// Helper function to calculate HMAC-SHA256
async function hmacSha256(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(message);
  
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, messageData);
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}
