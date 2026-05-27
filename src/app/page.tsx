"use client";

import Image from "next/image";
import { useState, useEffect, useRef } from "react";
import Pusher from "pusher-js";

// Define the structure of a reaction
interface Reaction {
  emoji: string;
  users: string[]; // Array of usernames who used this reaction
}

interface Message {
  id: string;
  text: string;
  username: string;
  timestamp: number;
  userId: string;
  reactions?: { [emoji: string]: string[] }; // e.g., { "👍": ["alice", "bob"], "❤️": ["charlie"] }
}

const COMMON_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

const generateId = () => {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
};

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState("");
  const [username, setUsername] = useState("");
  const [isJoined, setIsJoined] = useState(false);
  const [hoveredMessageId, setHoveredMessageId] = useState<string | null>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const userIdRef = useRef<string>(generateId());

  useEffect(() => {
    if (!isJoined) return;

    const pusher = new Pusher("bc4bbe143420c20c0e9d", {
      cluster: "ap1",
      authEndpoint: "/api/pusher-auth", 
    });

    const channel = pusher.subscribe("private-chat-channel");
    
    // Listen for new messages
    channel.bind("new-message", (data: Message) => {
      setMessages((prev) => {
        // Prevent duplicate appending if local state already has it
        if (prev.some((m) => m.id === data.id)) return prev;
        return [...prev, data];
      });
    });

    // Listen for real-time reaction updates
    channel.bind("message-reaction", (data: { messageId: string; reactions: { [emoji: string]: string[] } }) => {
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === data.messageId ? { ...msg, reactions: data.reactions } : msg
        )
      );
    });

    const savedMessages = localStorage.getItem("chat-messages");
    if (savedMessages) {
      try {
        setMessages(JSON.parse(savedMessages));
      } catch (e) {
        console.error("Error loading messages:", e);
      }
    }

    return () => {
      channel.unbind_all();
      channel.unsubscribe();
      pusher.disconnect();
    };
  }, [isJoined]);

  // Save messages to localStorage
  useEffect(() => {
    if (messages.length > 0) {
      localStorage.setItem("chat-messages", JSON.stringify(messages));
    }
  }, [messages]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputMessage.trim() || !username) return;

    const newMessage: Message = {
      id: generateId(),
      text: inputMessage,
      username: username,
      timestamp: Date.now(),
      userId: userIdRef.current,
      reactions: {},
    };

    // Optimistically update UI
    setMessages((prev) => [...prev, newMessage]);
    setInputMessage("");

    try {
      const response = await fetch("/api/send-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newMessage),
      });

      if (!response.ok) {
        const error = await response.json();
        console.error("Failed to send message:", error);
      }
    } catch (error) {
      console.error("Error sending message:", error);
    }
  };

  const handleReaction = async (messageId: string, emoji: string) => {
    const targetMessage = messages.find((m) => m.id === messageId);
    if (!targetMessage) return;

    const currentReactions = targetMessage.reactions || {};
    const existingUsers = currentReactions[emoji] || [];
    
    let updatedUsers: string[];
    if (existingUsers.includes(username)) {
      // Remove reaction if user already clicked it
      updatedUsers = existingUsers.filter((u) => u !== username);
    } else {
      // Add reaction
      updatedUsers = [...existingUsers, username];
    }

    const updatedReactions = {
      ...currentReactions,
      [emoji]: updatedUsers,
    };

    // Clean up empty emoji categories to keep the data lightweight
    if (updatedUsers.length === 0) {
      delete updatedReactions[emoji];
    }

    // Optimistically update local state
    setMessages((prev) =>
      prev.map((msg) =>
        msg.id === messageId ? { ...msg, reactions: updatedReactions } : msg
      )
    );

    try {
      // Note: You will need to create this route on your backend to trigger Pusher's "message-reaction" event
      await fetch("/api/send-reaction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId, reactions: updatedReactions }),
      });
    } catch (error) {
      console.error("Error syncing reaction:", error);
    }
  };

  const joinChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (username.trim()) {
      setIsJoined(true);
    }
  };

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  if (!isJoined) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full">
          <div className="text-center mb-8">
            <Image src="/next.svg" alt="Logo" width={120} height={30} className="mx-auto dark:invert" />
            <h2 className="text-2xl font-bold text-gray-800 mt-6">Join the Chat</h2>
            <p className="text-gray-600 mt-2">Enter your username to start chatting</p>
          </div>
          <form onSubmit={joinChat} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                placeholder="Enter your username"
                required
                maxLength={20}
              />
            </div>
            <button type="submit" className="w-full bg-blue-500 text-white py-2 px-4 rounded-lg hover:bg-blue-600 font-medium">
              Join Chat
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      {/* Header */}
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-4xl mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <Image src="/next.svg" alt="Logo" width={100} height={25} />
            <h1 className="text-xl font-semibold text-gray-800">Real-time Chat</h1>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-600">Logged in as:</span>
            <span className="font-medium text-gray-800">{username}</span>
            <button onClick={() => setIsJoined(false)} className="text-sm text-red-500 hover:text-red-600">
              Leave
            </button>
          </div>
        </div>
      </div>

      {/* Chat Container */}
      <div className="max-w-4xl mx-auto p-4">
        <div className="bg-white rounded-xl shadow-lg overflow-hidden">
          {/* Messages Area */}
          <div className="h-[500px] overflow-y-auto p-4 space-y-4">
            {messages.length === 0 && (
              <div className="text-center text-gray-500 mt-8">No messages yet. Start the conversation!</div>
            )}
            
            {messages.map((message) => {
              const isMe = message.userId === userIdRef.current;
              return (
                <div
                  key={message.id}
                  className={`flex ${isMe ? "justify-end" : "justify-start"}`}
                  onMouseEnter={() => setHoveredMessageId(message.id)}
                  onMouseLeave={() => setHoveredMessageId(null)}
                >
                  <div className={`relative max-w-[70%] group`}>
                    
                    {/* Reaction Floating Picker (shows on hover) */}
                    {hoveredMessageId === message.id && (
                      <div className={`absolute -top-10 z-10 flex bg-white border shadow-md rounded-full px-2 py-1 gap-1 transition-all ${isMe ? "right-0" : "left-0"}`}>
                        {COMMON_EMOJIS.map((emoji) => (
                          <button
                            key={emoji}
                            onClick={() => handleReaction(message.id, emoji)}
                            className="hover:scale-125 transition-transform text-sm p-0.5"
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Message Bubble */}
                    <div className={`rounded-lg p-3 ${isMe ? "bg-blue-500 text-white" : "bg-gray-100 text-gray-800"}`}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold text-sm">{message.username}</span>
                        <span className="text-xs opacity-75">{formatTime(message.timestamp)}</span>
                      </div>
                      <p className="break-words">{message.text}</p>
                    </div>

                    {/* Rendered Badges for Existing Reactions */}
                    {message.reactions && Object.keys(message.reactions).length > 0 && (
                      <div className={`flex flex-wrap gap-1 mt-1 ${isMe ? "justify-end" : "justify-start"}`}>
                        {Object.entries(message.reactions).map(([emoji, users]) => (
                          <button
                            key={emoji}
                            onClick={() => handleReaction(message.id, emoji)}
                            title={`Reacted by: ${users.join(", ")}`}
                            className={`flex items-center gap-1 text-xs border rounded-full px-2 py-0.5 bg-white shadow-sm transition-colors hover:bg-gray-50 ${
                              users.includes(username) ? "border-blue-400 bg-blue-50 text-blue-900" : "text-gray-700"
                            }`}
                          >
                            <span>{emoji}</span>
                            <span className="font-medium text-[10px]">{users.length}</span>
                          </button>
                        ))}
                      </div>
                    )}

                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>

          {/* Input Area */}
          <form onSubmit={sendMessage} className="border-t p-4">
            <div className="flex gap-2">
              <input
                type="text"
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                placeholder="Type a message..."
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                maxLength={500}
              />
              <button type="submit" className="bg-blue-500 text-white px-6 py-2 rounded-lg hover:bg-blue-600 font-medium">
                Send
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
