"use client";

import Image from "next/image";
import { useState, useEffect, useRef, useCallback } from "react";
import Pusher from "pusher-js";

type MessageStatus = "sending" | "sent" | "delivered" | "error";

interface Message {
  id: string;
  text: string;
  username: string;
  timestamp: number;
  userId: string;
  status?: MessageStatus;
}

// Firebase message structure
interface FirebaseMessage {
  text: string;
  username: string;
  timestamp: number;
  userId: string;
  createdAt: string;
}

const generateId = () => {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
};

const FIREBASE_DB_URL = "https://chatto-659ec-default-rtdb.firebaseio.com";

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState("");
  const [username, setUsername] = useState("");
  const [isJoined, setIsJoined] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const userIdRef = useRef<string>(generateId());

  // Load messages from Firebase - wrapped in useCallback to prevent recreation
  const loadMessages = useCallback(async () => {
    try {
      console.log("Loading messages from Firebase...");
      const response = await fetch(`${FIREBASE_DB_URL}/messages.json`);
      const data: Record<string, FirebaseMessage> = await response.json();
      
      const loadedMessages: Message[] = [];
      if (data) {
        Object.keys(data).forEach((key) => {
          const msg = data[key];
          loadedMessages.push({
            id: key,
            text: msg.text,
            username: msg.username,
            timestamp: msg.timestamp,
            userId: msg.userId,
            status: "delivered", // Messages from Firebase are already delivered
          });
        });
      }
      
      loadedMessages.sort((a, b) => a.timestamp - b.timestamp);
      console.log("Loaded messages:", loadedMessages.length);
      setMessages(loadedMessages);
    } catch (error) {
      console.error("Error loading messages:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Initial load when joining chat
  useEffect(() => {
    if (!isJoined) return;
    loadMessages();
  }, [isJoined, loadMessages]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Initialize Pusher for real-time updates
  useEffect(() => {
    if (!isJoined) return;

    console.log("Initializing Pusher...");
    const pusher = new Pusher("bc4bbe143420c20c0e9d", {
      cluster: "ap1",
      authEndpoint: "/api/pusher-auth",
    });

    const channel = pusher.subscribe("private-chat-channel");
    
    channel.bind("new-message", (data: Message) => {
      console.log("New message received via Pusher:", data);
      // Immediately add the message to the UI without reloading all messages
      setMessages((prevMessages: Message[]) => {
        // Check if message already exists to avoid duplicates
        const exists = prevMessages.some(msg => msg.id === data.id);
        if (!exists) {
          const newMessages: Message[] = [...prevMessages, { ...data, status: "delivered" }];
          newMessages.sort((a, b) => a.timestamp - b.timestamp);
          return newMessages;
        }
        return prevMessages;
      });
    });

    return () => {
      channel.unbind_all();
      channel.unsubscribe();
      pusher.disconnect();
    };
  }, [isJoined]);

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputMessage.trim() || !username) return;

    const messageId = generateId();
    const newMessage: Message = {
      id: messageId,
      text: inputMessage,
      username: username,
      timestamp: Date.now(),
      userId: userIdRef.current,
      status: "sending", // Initial status
    };

    console.log("Sending message:", newMessage);
    
    // Clear input immediately
    setInputMessage("");
    
    // Optimistically add message to UI with "sending" status
    setMessages((prevMessages: Message[]) => {
      const exists = prevMessages.some(msg => msg.id === messageId);
      if (!exists) {
        const newMessages: Message[] = [...prevMessages, newMessage];
        newMessages.sort((a, b) => a.timestamp - b.timestamp);
        return newMessages;
      }
      return prevMessages;
    });

    try {
      // Update status to "sent" after API call starts
      setMessages((prevMessages: Message[]) =>
        prevMessages.map((msg) =>
          msg.id === messageId ? { ...msg, status: "sent" as MessageStatus } : msg
        )
      );

      const response = await fetch("/api/send-message", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(newMessage),
      });

      if (response.ok) {
        console.log("Message sent successfully");
        // Update status to "delivered" after successful save
        setMessages((prevMessages: Message[]) =>
          prevMessages.map((msg) =>
            msg.id === messageId ? { ...msg, status: "delivered" as MessageStatus } : msg
          )
        );
        
        // Auto-remove status after 2 seconds (optional)
        setTimeout(() => {
          setMessages((prevMessages: Message[]) =>
            prevMessages.map((msg) =>
              msg.id === messageId ? { ...msg, status: undefined } : msg
            )
          );
        }, 2000);
      } else {
        const error = await response.json();
        console.error("Failed to send message:", error);
        // Update status to "error"
        setMessages((prevMessages: Message[]) =>
          prevMessages.map((msg) =>
            msg.id === messageId ? { ...msg, status: "error" as MessageStatus } : msg
          )
        );
        
        // Auto-retry option could be added here
        setTimeout(() => {
          setMessages((prevMessages: Message[]) =>
            prevMessages.map((msg) =>
              msg.id === messageId ? { ...msg, status: undefined } : msg
            )
          );
        }, 3000);
      }
    } catch (error) {
      console.error("Error sending message:", error);
      // Update status to "error"
      setMessages((prevMessages: Message[]) =>
        prevMessages.map((msg) =>
          msg.id === messageId ? { ...msg, status: "error" as MessageStatus } : msg
        )
      );
      
      setTimeout(() => {
        setMessages((prevMessages: Message[]) =>
          prevMessages.map((msg) =>
            msg.id === messageId ? { ...msg, status: undefined } : msg
          )
        );
      }, 3000);
    }
  };

  const joinChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (username.trim()) {
      console.log("User joined:", username);
      setIsJoined(true);
    }
  };

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getStatusIcon = (status?: MessageStatus) => {
    switch (status) {
      case "sending":
        return (
          <div className="flex items-center gap-1 text-xs text-gray-500">
            <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <span>Sending...</span>
          </div>
        );
      case "sent":
        return (
          <div className="flex items-center gap-1 text-xs text-blue-500">
            <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span>Sent</span>
          </div>
        );
      case "delivered":
        return (
          <div className="flex items-center gap-1 text-xs text-green-500">
            <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>Delivered</span>
          </div>
        );
      case "error":
        return (
          <div className="flex items-center gap-1 text-xs text-red-500">
            <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>Failed</span>
          </div>
        );
      default:
        return null;
    }
  };

  if (!isJoined) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full">
          <div className="text-center mb-8">
            <Image
              src="/next.svg"
              alt="Logo"
              width={120}
              height={30}
              className="mx-auto dark:invert"
            />
            <h2 className="text-2xl font-bold text-gray-800 mt-6">
              Join the Chat
            </h2>
            <p className="text-gray-600 mt-2">
              Enter your username to start chatting
            </p>
          </div>
          <form onSubmit={joinChat} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Username
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Enter your username"
                required
                maxLength={20}
              />
            </div>
            <button
              type="submit"
              className="w-full bg-blue-500 text-white py-2 px-4 rounded-lg hover:bg-blue-600 transition-colors font-medium"
            >
              Join Chat
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-4xl mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <Image src="/next.svg" alt="Logo" width={100} height={25} />
            <h1 className="text-xl font-semibold text-gray-800">Real-time Chat</h1>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-600">Logged in as:</span>
            <span className="font-medium text-gray-800">{username}</span>
            <button
              onClick={() => setIsJoined(false)}
              className="text-sm text-red-500 hover:text-red-600"
            >
              Leave
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto p-4">
        <div className="bg-white rounded-xl shadow-lg overflow-hidden">
          <div className="h-[500px] overflow-y-auto p-4 space-y-3">
            {isLoading && (
              <div className="text-center text-gray-500 mt-8">
                Loading messages...
              </div>
            )}
            {!isLoading && messages.length === 0 && (
              <div className="text-center text-gray-500 mt-8">
                No messages yet. Start the conversation!
              </div>
            )}
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex ${
                  message.userId === userIdRef.current
                    ? "justify-end"
                    : "justify-start"
                }`}
              >
                <div
                  className={`max-w-[70%] rounded-lg p-3 ${
                    message.userId === userIdRef.current
                      ? "bg-blue-500 text-white"
                      : "bg-gray-100 text-gray-800"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-sm">
                      {message.username}
                    </span>
                    <span className="text-xs opacity-75">
                      {formatTime(message.timestamp)}
                    </span>
                  </div>
                  <p className="break-words">{message.text}</p>
                  {/* Status indicator - only shown for own messages */}
                  {message.userId === userIdRef.current && message.status && (
                    <div className="mt-1 flex justify-end">
                      {getStatusIcon(message.status)}
                    </div>
                  )}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          <form onSubmit={sendMessage} className="border-t p-4">
            <div className="flex gap-2">
              <input
                type="text"
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                placeholder="Type a message..."
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                maxLength={500}
              />
              <button
                type="submit"
                className="bg-blue-500 text-white px-6 py-2 rounded-lg hover:bg-blue-600 transition-colors font-medium"
              >
                Send
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
