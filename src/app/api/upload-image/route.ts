import { NextResponse } from "next/server";

const FIREBASE_DB_URL = "https://chatto-659ec-default-rtdb.firebaseio.com";

interface UploadRequest {
  imageData: {
    full: string;
    thumbnail: string;
  };
  messageId: string;
}

export async function POST(request: Request) {
  try {
    const body: UploadRequest = await request.json();
    const { imageData, messageId } = body;
    
    if (!imageData || !messageId) {
      return NextResponse.json({ error: "Missing image data" }, { status: 400 });
    }
    
    // Store the image in a separate Firebase path
    const imageResponse = await fetch(`${FIREBASE_DB_URL}/images/${messageId}.json`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        full: imageData.full,
        thumbnail: imageData.thumbnail,
        timestamp: Date.now(),
      }),
    });
    
    if (!imageResponse.ok) {
      const errorText = await imageResponse.text();
      console.error("Firebase image store error:", errorText);
      throw new Error("Failed to store image");
    }
    
    const result = await imageResponse.json();
    console.log("Image stored successfully:", result);
    
    return NextResponse.json({ success: true, messageId });
    
  } catch (error) {
    console.error("Error uploading image:", error);
    return NextResponse.json(
      { error: "Failed to upload image", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
