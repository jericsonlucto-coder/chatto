import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    console.log("API route hit");
    const message = await request.json();
    console.log("Message:", message);
    
    // Try to dynamically import Pusher only when needed
    let Pusher;
    try {
      Pusher = (await import('pusher')).default;
      console.log("Pusher imported successfully");
    } catch (importError) {
      console.error("Failed to import Pusher:", importError);
      return NextResponse.json({ 
        success: false, 
        error: "Pusher library not available",
        details: importError.message 
      }, { status: 500 });
    }
    
    // Replace with your actual Pusher credentials
    const pusher = new Pusher({
      appId: "2159204",    // Replace this
      key: "bc4bbe143420c20c0e9d",          // Replace this
      secret: "bbd18207d17c2f39529e",    // Replace this
      cluster: "ap1",  // Replace this
      useTLS: true,
    });
    
    console.log("Pusher instance created, attempting to trigger...");
    
    const result = await pusher.trigger("chat-channel", "new-message", message);
    console.log("Pusher trigger result:", result);
    
    return NextResponse.json({ success: true, result });
    
  } catch (error) {
    console.error("Error in API route:", error);
    return NextResponse.json(
      { 
        success: false,
        error: error.message,
        stack: error.stack 
      },
      { status: 500 }
    );
  }
}
