"use client";

import Image from "next/image";
import { useState, useEffect, useRef } from "react";
import Pusher from "pusher-js";

interface Message {
  id: string;
  text: string;
  username: string;
  timestamp: number;
  userId: string;
  reactions?: {
    [key: string]: string[]; // emoji -> array of userIds
  };
}

interface ReactionEvent {
  messageId: string;
  emoji: string;
  userId: string;
  username: string;
  action: "add" | "remove";
}

// Simple ID generator
const generateId = () => {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
};

// Available emojis for reactions
const AVAILABLE_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🎉"];

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState("");
  const [username, setUsername] = useState("");
  const [isJoined, setIsJoined] = useState(false);
  const [showReactionPicker, setShowReactionPicker] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const userIdRef = useRef<string>(generateId());
  const reactionPickerRef = useRef<HTMLDivElement>(null);

  // Close reaction picker when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (reactionPickerRef.current && !reactionPickerRef.current.contains(event.target as Node)) {
        setShowReactionPicker(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Initialize Pusher with your credentials
  useEffect(() => {
    if (!isJoined) return;

    const pusher = new Pusher("bc4bbe143420c20c0e9d", {
      cluster: "ap1",
      authEndpoint: "/api/pusher-auth",
    });

    const channel = pusher.subscribe("private-chat-channel");
    
    channel.bind("new-message", (data: Message) => {
      console.log("New message received:", data);
      setMessages((prev) => [...prev, data]);
    });

    channel.bind("message-reaction", (data: ReactionEvent) => {
      console.log("Reaction event received:", data);
      setMessages((prev) => 
        prev.map((msg) => {
          if (msg.id === data.messageId) {
            const updatedReactions = { ...(msg.reactions || {}) };
            
            if (data.action === "add") {
              if (!updatedReactions[data.emoji]) {
                updatedReactions[data.emoji] = [];
              }
              if (!updatedReactions[data.emoji].includes(data.userId)) {
                updatedReactions[data.emoji].push(data.userId);
              }
            } else if (data.action === "remove") {
              if (updatedReactions[data.emoji]) {
                updatedReactions[data.emoji] = updatedReactions[data.emoji].filter(
                  (id) => id !== data.userId
                );
                if (updatedReactions[data.emoji].length === 0) {
                  delete updatedReactions[data.emoji];
                }
              }
            }
            
            return { ...msg, reactions: updatedReactions };
          }
          return msg;
        })
      );
    });

    // Load existing messages from localStorage
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

  // Auto-scroll to bottom
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

    try {
      const response = await fetch("/api/send-message", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(newMessage),
      });

      if (response.ok) {
        setInputMessage("");
      } else {
        const error = await response.json();
        console.error("Failed to send message:", error);
      }
    } catch (error) {
      console.error("Error sending message:", error);
    }
  };

  const handleReaction = async (messageId: string, emoji: string) => {
    const message = messages.find((m) => m.id === messageId);
    if (!message) return;

    const currentReactions = message.reactions || {};
    const hasReacted = currentReactions[emoji]?.includes(userIdRef.current);
    
    const reactionEvent: ReactionEvent = {
      messageId,
      emoji,
      userId: userIdRef.current,
      username,
      action: hasReacted ? "remove" : "add",
    };

    try {
      const response = await fetch("/api/send-reaction", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(reactionEvent),
      });

      if (response.ok) {
        // Optimistically update UI
        setMessages((prev) =>
          prev.map((msg) => {
            if (msg.id === messageId) {
              const updatedReactions = { ...(msg.reactions || {}) };
              
              if (reactionEvent.action === "add") {
                if (!updatedReactions[emoji]) {
                  updatedReactions[emoji] = [];
                }
                if (!updatedReactions[emoji].includes(userIdRef.current)) {
                  updatedReactions[emoji].push(userIdRef.current);
                }
              } else {
                if (updatedReactions[emoji]) {
                  updatedReactions[emoji] = updatedReactions[emoji].filter(
                    (id) => id !== userIdRef.current
                  );
                  if (updatedReactions[emoji].length === 0) {
                    delete updatedReactions[emoji];
                  }
                }
              }
              
              return { ...msg, reactions: updatedReactions };
            }
            return msg;
          })
        );
        setShowReactionPicker(null);
      } else {
        const error = await response.json();
        console.error("Failed to send reaction:", error);
      }
    } catch (error) {
      console.error("Error sending reaction:", error);
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

  const getReactionCount = (reactions: { [key: string]: string[] } | undefined, emoji: string) => {
    if (!reactions || !reactions[emoji]) return 0;
    return reactions[emoji].length;
  };

  const hasUserReacted = (reactions: { [key: string]: string[] } | undefined, emoji: string) => {
    if (!reactions || !reactions[emoji]) return false;
    return reactions[emoji].includes(userIdRef.current);
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
            <button
              onClick={() => setIsJoined(false)}
              className="text-sm text-red-500 hover:text-red-600"
            >
              Leave
            </button>
          </div>
        </div>
      </div>

      {/* Chat Container */}
      <div className="max-w-4xl mx-auto p-4">
        <div className="bg-white rounded-xl shadow-lg overflow-hidden">
          {/* Messages Area */}
          <div className="h-[500px] overflow-y-auto p-4 space-y-3">
            {messages.length === 0 && (
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
                  
                  {/* Reactions Display */}
                  {message.reactions && Object.keys(message.reactions).length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {Object.entries(message.reactions).map(([emoji, users]) => (
                        <button
                          key={emoji}
                          onClick={() => handleReaction(message.id, emoji)}
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs transition-colors ${
                            users.includes(userIdRef.current)
                              ? "bg-blue-100 text-blue-700 border border-blue-300"
                              : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                          }`}
                        >
                          <span>{emoji}</span>
                          <span>{users.length}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  
                  {/* Add Reaction Button */}
                  <div className="relative">
                    <button
                      onClick={() => setShowReactionPicker(showReactionPicker === message.id ? null : message.id)}
                      className="absolute -top-6 right-0 opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-gray-600 text-xs"
                      style={{ opacity: 0 }}
                      onMouseEnter={(e) => {
                        const btn = e.currentTarget;
                        btn.style.opacity = "1";
                      }}
                      onMouseLeave={(e) => {
                        if (showReactionPicker !== message.id) {
                          btn.style.opacity = "0";
                        }
                      }}
                    >
                      😊 Add reaction
                    </button>
                    
                    {/* Reaction Picker */}
                    {showReactionPicker === message.id && (
                      <div
                        ref={reactionPickerRef}
                        className="absolute bottom-full left-0 mb-2 bg-white rounded-lg shadow-lg border p-2 flex gap-1 z-10"
                      >
                        {AVAILABLE_REACTIONS.map((emoji) => (
                          <button
                            key={emoji}
                            onClick={() => handleReaction(message.id, emoji)}
                            className={`w-8 h-8 hover:bg-gray-100 rounded-full transition-colors text-lg flex items-center justify-center ${
                              hasUserReacted(message.reactions, emoji)
                                ? "bg-blue-50 ring-2 ring-blue-300"
                                : ""
                            }`}
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
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

      <style jsx>{`
        .group:hover button {
          opacity: 1;
        }
      `}</style>
    </div>
  );
}
