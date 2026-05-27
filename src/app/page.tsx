"use client";

import Image from "next/image";
import { useState, useEffect, useRef } from "react";
import Pusher from "pusher-js";

interface Reaction {
  type: string;
  userId: string;
  username: string;
}

interface Message {
  id: string;
  text: string;
  username: string;
  timestamp: number;
  userId: string;
  reactions?: Reaction[];
}

// Simple ID generator
const generateId = () => {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
};

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState("");
  const [username, setUsername] = useState("");
  const [isJoined, setIsJoined] = useState(false);
  const [activeReactionMenu, setActiveReactionMenu] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const userIdRef = useRef<string>(generateId());

  // Initialize Pusher with your credentials
  useEffect(() => {
    if (!isJoined) return;

    // Use your actual Pusher credentials
    const pusher = new Pusher("bc4bbe143420c20c0e9d", {
      cluster: "ap1",
      authEndpoint: "/api/pusher-auth", // Your auth endpoint
    });

    const channel = pusher.subscribe("private-chat-channel");
    
    channel.bind("new-message", (data: Message) => {
      console.log("New message received:", data);
      setMessages((prev) => [...prev, data]);
    });

    channel.bind("message-reaction", (data: { messageId: string; reaction: Reaction }) => {
      console.log("Reaction received:", data);
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === data.messageId
            ? {
                ...msg,
                reactions: [...(msg.reactions || []), data.reaction],
              }
            : msg
        )
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
      reactions: [],
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

  const addReaction = async (messageId: string, reactionType: string) => {
    const reaction: Reaction = {
      type: reactionType,
      userId: userIdRef.current,
      username: username,
    };

    // Optimistically update UI
    setMessages((prev) =>
      prev.map((msg) =>
        msg.id === messageId
          ? {
              ...msg,
              reactions: [...(msg.reactions || []), reaction],
            }
          : msg
      )
    );

    try {
      const response = await fetch("/api/add-reaction", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ messageId, reaction }),
      });

      if (!response.ok) {
        // Revert on error
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === messageId
              ? {
                  ...msg,
                  reactions: msg.reactions?.filter(
                    (r) => !(r.userId === userIdRef.current && r.type === reactionType)
                  ),
                }
              : msg
          )
        );
        const error = await response.json();
        console.error("Failed to add reaction:", error);
      }
    } catch (error) {
      console.error("Error adding reaction:", error);
      // Revert on error
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === messageId
            ? {
                ...msg,
                reactions: msg.reactions?.filter(
                  (r) => !(r.userId === userIdRef.current && r.type === reactionType)
                ),
              }
            : msg
        )
      );
    }

    setActiveReactionMenu(null);
  };

  const getReactionEmoji = (type: string) => {
    switch (type) {
      case "heart":
        return "❤️";
      case "haha":
        return "😂";
      default:
        return type;
    }
  };

  const getReactionCounts = (reactions: Reaction[] | undefined) => {
    if (!reactions) return {};
    const counts: { [key: string]: number } = {};
    reactions.forEach((reaction) => {
      counts[reaction.type] = (counts[reaction.type] || 0) + 1;
    });
    return counts;
  };

  const hasUserReacted = (reactions: Reaction[] | undefined, reactionType: string) => {
    return reactions?.some((r) => r.userId === userIdRef.current && r.type === reactionType);
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
                <div className="relative group max-w-[70%]">
                  <div
                    className={`rounded-lg p-3 ${
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
                    {message.reactions && message.reactions.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {Object.entries(getReactionCounts(message.reactions)).map(
                          ([type, count]) => (
                            <div
                              key={type}
                              className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${
                                hasUserReacted(message.reactions, type)
                                  ? "bg-blue-100 text-blue-700"
                                  : "bg-gray-200 text-gray-700"
                              }`}
                            >
                              <span>{getReactionEmoji(type)}</span>
                              <span>{count}</span>
                            </div>
                          )
                        )}
                      </div>
                    )}
                  </div>
                  
                  {/* Reaction Button */}
                  {message.userId !== userIdRef.current && (
                    <button
                      onClick={() =>
                        setActiveReactionMenu(
                          activeReactionMenu === message.id ? null : message.id
                        )
                      }
                      className="absolute -right-2 -top-2 bg-white rounded-full shadow-md p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <span className="text-sm">😊</span>
                    </button>
                  )}
                  
                  {/* Reaction Menu */}
                  {activeReactionMenu === message.id && (
                    <div className="absolute -top-10 left-0 bg-white rounded-lg shadow-lg border p-1 flex gap-1 z-10">
                      <button
                        onClick={() => addReaction(message.id, "heart")}
                        className="hover:bg-gray-100 p-2 rounded transition-colors text-xl"
                        title="Heart"
                      >
                        ❤️
                      </button>
                      <button
                        onClick={() => addReaction(message.id, "haha")}
                        className="hover:bg-gray-100 p-2 rounded transition-colors text-xl"
                        title="Haha"
                      >
                        😂
                      </button>
                    </div>
                  )}
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
    </div>
  );
}
