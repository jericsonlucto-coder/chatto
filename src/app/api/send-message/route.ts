import { NextResponse } from "next/server";
import Pusher from "pusher"; // ← Import from 'pusher', NOT 'pusher-js'

// REPLACE WITH YOUR ACTUAL PUSHER CREDENTIALS
const pusher = new Pusher({
  appId: "YOUR_APP_ID",
  key: "YOUR_PUSHER_KEY",
  secret: "YOUR_PUSHER_SECRET",
  cluster: "YOUR_CLUSTER",
  useTLS: true,
});

export async function POST(request: Request) {
  try {
    const message = await request.json();

    await pusher.trigger("chat-channel", "new-message", message);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error sending message:", error);
    return NextResponse.json(
      { error: "Failed to send message" },
      { status: 500 }
    );
  }
}
