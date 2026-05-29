"use client";
import NextImage from "next/image";
import { useState, useEffect, useRef } from "react";
import Pusher from "pusher-js";

// ============================================================
// TYPES & INTERFACES
// ============================================================
type MessageStatus = "sending" | "sent" | "delivered" | "error";
type ReactionType = "👍" | "❤️" | "😂" | "😮" | "😢" | "🙏";
type MessageType = "text" | "image";
type Theme = "light" | "dark";

interface Reaction {
  type: ReactionType;
  userId: string;
  username: string;
  timestamp: number;
}

interface Message {
  id: string;
  text: string;
  username: string;
  timestamp: number;
  userId: string;
  status?: MessageStatus;
  reactions?: Reaction[];
  type?: MessageType;
  imageId?: string;
  imageUrl?: string;
  imageThumbnail?: string;
}

interface User {
  id: string;
  username: string;
  joinedAt: number;
  lastActive: number;
}

// ============================================================
// CONSTANTS
// ============================================================
const FIREBASE_DB_URL = "https://chatto-659ec-default-rtdb.firebaseio.com";
const REACTIONS: ReactionType[] = ["👍", "❤️", "😂", "😮", "😢", "🙏"];
const HEARTBEAT_INTERVAL = 30000;
const USER_ACTIVE_THRESHOLD = 60000;
const USER_REFRESH_INTERVAL = 5000;
const STATUS_CLEAR_DELAY = 2000;
const MESSAGES_PER_PAGE = 50;
const MAX_IMAGE_SIZE = 2 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

// ============================================================
// UTILITIES
// ============================================================
const generateId = () =>
  Date.now().toString(36) + Math.random().toString(36).substring(2, 9);

const formatTime = (timestamp: number) =>
  new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

const sanitizeReactions = (reactions: Reaction[] | undefined): Reaction[] =>
  (reactions || []).filter((r) => r !== null && r !== undefined);

const getReactionCounts = (reactions?: Reaction[]): Record<string, number> => {
  if (!reactions) return {};
  return sanitizeReactions(reactions).reduce(
    (acc: Record<string, number>, r) => {
      acc[r.type] = (acc[r.type] || 0) + 1;
      return acc;
    },
    {}
  );
};

const getUniqueReactions = (reactions?: Reaction[]): Reaction[] => {
  if (!reactions) return [];
  const unique = new Map<ReactionType, Reaction>();
  sanitizeReactions(reactions).forEach((r) => {
    if (!unique.has(r.type)) unique.set(r.type, r);
  });
  return Array.from(unique.values());
};

const processImage = async (file: File): Promise<{ full: string; thumbnail: string }> => {
  return new Promise((resolve, reject) => {
    const img = document.createElement('img');
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const thumbCanvas = document.createElement("canvas");
      
      let width = img.width;
      let height = img.height;
      if (width > 800) {
        height = (height * 800) / width;
        width = 800;
      }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx?.drawImage(img, 0, 0, width, height);
      const full = canvas.toDataURL("image/jpeg", 0.7);
      
      let thumbWidth = img.width;
      let thumbHeight = img.height;
      if (thumbWidth > 150) {
        thumbHeight = (thumbHeight * 150) / thumbWidth;
        thumbWidth = 150;
      }
      thumbCanvas.width = thumbWidth;
      thumbCanvas.height = thumbHeight;
      const thumbCtx = thumbCanvas.getContext("2d");
      thumbCtx?.drawImage(img, 0, 0, thumbWidth, thumbHeight);
      const thumbnail = thumbCanvas.toDataURL("image/jpeg", 0.5);
      
      resolve({ full, thumbnail });
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
};

const fetchImage = async (imageId: string): Promise<{ full: string; thumbnail: string } | null> => {
  try {
    const res = await fetch(`${FIREBASE_DB_URL}/images/${imageId}.json`);
    const data = await res.json();
    if (data && typeof data === 'object' && 'full' in data && 'thumbnail' in data) {
      return data as { full: string; thumbnail: string };
    }
    return null;
  } catch (err) {
    console.error("Error fetching image:", err);
    return null;
  }
};

// ============================================================
// API HELPERS
// ============================================================
const api = {
  getAllMessages: async (): Promise<Record<string, any>> => {
    try {
      const res = await fetch(`${FIREBASE_DB_URL}/messages.json`);
      const data = await res.json();
      return data || {};
    } catch (err) {
      console.error("Error getting all messages:", err);
      return {};
    }
  },
  getAllImages: async (): Promise<Record<string, any>> => {
    try {
      const res = await fetch(`${FIREBASE_DB_URL}/images.json`);
      const data = await res.json();
      return data || {};
    } catch (err) {
      console.error("Error getting all images:", err);
      return {};
    }
  },
  getUsers: () => fetch(`${FIREBASE_DB_URL}/users.json`),
  putUser: (userId: string, data: object) =>
    fetch(`${FIREBASE_DB_URL}/users/${userId}.json`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  patchUser: (userId: string, data: object) =>
    fetch(`${FIREBASE_DB_URL}/users/${userId}.json`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  deleteUser: (userId: string) =>
    fetch(`${FIREBASE_DB_URL}/users/${userId}.json`, { method: "DELETE" }),
  putReactions: (messageId: string, reactions: Reaction[]) =>
    fetch(`${FIREBASE_DB_URL}/messages/${messageId}/reactions.json`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reactions),
    }),
  sendMessage: (message: Message) =>
    fetch("/api/send-message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
    }),
  sendReaction: (messageId: string, reaction: Reaction | null) =>
    fetch("/api/send-reaction", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId, reaction }),
    }),
};

// ============================================================
// THEME CONTEXT
// ============================================================
function useTheme() {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const savedTheme = localStorage.getItem("theme") as Theme | null;
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const initialTheme = savedTheme || (prefersDark ? "dark" : "light");
    setTheme(initialTheme);
    document.documentElement.classList.toggle("dark", initialTheme === "dark");
  }, []);

  const toggleTheme = () => {
    const newTheme = theme === "light" ? "dark" : "light";
    setTheme(newTheme);
    localStorage.setItem("theme", newTheme);
    document.documentElement.classList.toggle("dark", newTheme === "dark");
  };

  return { theme, toggleTheme };
}

// ============================================================
// JOIN SCREEN COMPONENT
// ============================================================
function JoinScreen({ 
  username, 
  onUsernameChange, 
  onSubmit,
  theme,
  toggleTheme
}: { 
  username: string; 
  onUsernameChange: (value: string) => void; 
  onSubmit: (e: React.FormEvent) => void;
  theme: Theme;
  toggleTheme: () => void;
}) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 flex items-center justify-center p-4 transition-colors duration-300">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-8 sm:p-10 max-w-md w-full transition-colors duration-300">
        {/* Theme Toggle Button */}
        <button
          onClick={toggleTheme}
          className="absolute top-4 right-4 p-2 rounded-full bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
          aria-label="Toggle theme"
        >
          {theme === "light" ? (
            <svg className="w-5 h-5 text-gray-800 dark:text-gray-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
            </svg>
          ) : (
            <svg className="w-5 h-5 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
          )}
        </button>

        <div className="text-center mb-8">
          <div className="w-20 h-20 bg-blue-500 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg">
            <NextImage src="/next.svg" alt="Logo" width={50} height={50} className="brightness-0 invert" />
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold text-gray-800 dark:text-white">
            Welcome to Chatto
          </h2>
          <p className="text-gray-500 dark:text-gray-400 mt-2 text-sm">Connect with friends in real-time</p>
        </div>
        <form onSubmit={onSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => onUsernameChange(e.target.value)}
              className="w-full px-4 py-3 border-2 border-gray-200 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all text-sm sm:text-base bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              placeholder="Enter your username"
              required
              maxLength={20}
              autoFocus
            />
          </div>
          <button 
            type="submit" 
            className="w-full bg-blue-500 text-white py-3 rounded-xl hover:bg-blue-600 transition-all duration-200 font-semibold text-sm sm:text-base shadow-lg hover:shadow-xl"
          >
            Join Chat
          </button>
        </form>
      </div>
    </div>
  );
}

// ============================================================
// CHAT SCREEN COMPONENT
// ============================================================
function ChatScreen({
  messages,
  inputMessage,
  setInputMessage,
  username,
  onlineUsers,
  hoveredMessageId,
  setHoveredMessageId,
  isMobileMenuOpen,
  setIsMobileMenuOpen,
  isUserScrolled,
  showScrollButton,
  newMessageCount,
  showLoadMoreButton,
  hasMoreMessages,
  isLoading,
  isLoadingMore,
  isUploading,
  userId,
  messagesEndRef,
  messagesContainerRef,
  fileInputRef,
  inputRef,
  onSendMessage,
  onLoadMoreMessages,
  onAddReaction,
  onScrollToBottom,
  onClearSavedUser,
  onImageUpload,
  onFileSelect,
  onPaste,
  onScroll,
  updateUserActivity,
  theme,
  toggleTheme,
}: any) {
  return (
    <div className="h-screen flex flex-col bg-gradient-to-br from-gray-50 via-blue-50 to-indigo-100 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 overflow-hidden transition-colors duration-300">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 shadow-lg border-b border-gray-200 dark:border-gray-700 flex-shrink-0 transition-colors duration-300">
        <div className="px-4 sm:px-6 py-3 flex justify-between items-center w-full lg:max-w-[90%] xl:max-w-[80%] mx-auto">
          <div className="flex items-center gap-3">
            <button 
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} 
              className="lg:hidden p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl transition-colors"
            >
              <svg className="h-5 w-5 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <div className="w-10 h-10 bg-blue-500 rounded-xl flex items-center justify-center shadow-md">
              <NextImage src="/next.svg" alt="Logo" width={24} height={6} className="brightness-0 invert" />
            </div>
            <div>
              <h1 className="text-lg sm:text-xl font-bold text-gray-800 dark:text-white">Chatto</h1>
              <p className="text-xs text-gray-500 dark:text-gray-400 hidden sm:block">Real-time messaging</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {/* Theme Toggle Button */}
            <button
              onClick={toggleTheme}
              className="p-2 rounded-full bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
              aria-label="Toggle theme"
            >
              {theme === "light" ? (
                <svg className="w-5 h-5 text-gray-800 dark:text-gray-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
              ) : (
                <svg className="w-5 h-5 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              )}
            </button>
            
            <div className="hidden sm:flex items-center gap-4">
              <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 dark:bg-gray-700 rounded-full">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                <span className="text-sm text-gray-600 dark:text-gray-300">{username}</span>
              </div>
              <button 
                onClick={onClearSavedUser} 
                className="text-sm text-red-500 hover:text-red-600 font-medium transition-colors"
              >
                Leave
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Container with Gap and Centering */}
      <div className="flex-1 flex items-center justify-center p-4 overflow-hidden min-h-0">
        <div className="w-full lg:max-w-[90%] xl:max-w-[80%] h-full flex gap-4">
          
          {/* Online Users Sidebar - Separate Container */}
          <div className={`lg:flex lg:w-72 bg-white dark:bg-gray-800 rounded-2xl shadow-xl flex-shrink-0 flex flex-col overflow-hidden transition-all duration-300 ${
            isMobileMenuOpen ? 'fixed inset-y-0 left-0 z-50 w-72 translate-x-0' : 'hidden lg:flex'
          }`}>
            <div className="p-4 bg-gradient-to-r from-blue-500 to-indigo-600">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center">
                    <svg className="h-4 w-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                    </svg>
                  </div>
                  <h3 className="font-semibold text-white text-sm">Active Users</h3>
                  <span className="bg-white/20 text-white text-xs px-2 py-0.5 rounded-full">{onlineUsers.length}</span>
                </div>
                <button onClick={() => setIsMobileMenuOpen(false)} className="lg:hidden text-white hover:text-gray-200">
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {onlineUsers.length === 0 ? (
                <div className="text-center text-gray-500 dark:text-gray-400 py-12">
                  <svg className="h-12 w-12 mx-auto mb-3 text-gray-300 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                  </svg>
                  <p className="text-sm">No active users</p>
                </div>
              ) : (
                onlineUsers.map((user: User) => (
                  <UserListItem key={user.id} user={user} isCurrentUser={user.id === userId} />
                ))
              )}
            </div>
          </div>

          {/* Overlay for mobile sidebar */}
          {isMobileMenuOpen && (
            <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setIsMobileMenuOpen(false)} />
          )}

          {/* Chat Area - Separate Container */}
          <div className="flex-1 bg-white dark:bg-gray-800 rounded-2xl shadow-xl flex flex-col overflow-hidden transition-colors duration-300">
            {/* Load More Button */}
            {showLoadMoreButton && hasMoreMessages && !isLoading && messages.length > 0 && (
              <div className="sticky top-0 z-10 p-3 flex justify-center bg-white/95 dark:bg-gray-800/95 backdrop-blur-sm border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
                <button 
                  onClick={onLoadMoreMessages} 
                  disabled={isLoadingMore} 
                  className="bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 px-4 py-2 rounded-xl text-sm transition-all flex items-center gap-2 shadow-md"
                >
                  {isLoadingMore ? (
                    <>
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      <span>Loading older messages...</span>
                    </>
                  ) : (
                    <>
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                      <span>Load older messages</span>
                    </>
                  )}
                </button>
              </div>
            )}
            
            {/* Scroll to Bottom Button */}
            {showScrollButton && newMessageCount === 0 && (
              <button 
                onClick={onScrollToBottom} 
                className="absolute bottom-20 right-4 bg-blue-500 text-white rounded-full p-2 shadow-lg hover:bg-blue-600 transition-all z-10"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                </svg>
              </button>
            )}
            
            {/* New Message Count Button */}
            {newMessageCount > 0 && (
              <button 
                onClick={onScrollToBottom} 
                className="absolute bottom-20 right-4 bg-blue-500 text-white rounded-full px-3 py-2 shadow-lg hover:bg-blue-600 transition-all z-10 text-sm flex items-center gap-2"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                </svg>
                {newMessageCount} new
              </button>
            )}
            
            {/* Messages Container */}
            <div 
              ref={messagesContainerRef} 
              onScroll={onScroll} 
              className="flex-1 overflow-y-auto p-4 space-y-3"
            >
              {isLoading && (
                <div className="flex justify-center items-center h-full">
                  <div className="text-center">
                    <svg className="animate-spin h-8 w-8 text-blue-500 mx-auto mb-3" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <p className="text-gray-500 dark:text-gray-400">Loading messages...</p>
                  </div>
                </div>
              )}
              {!isLoading && messages.length === 0 && (
                <div className="flex justify-center items-center h-full">
                  <div className="text-center">
                    <svg className="h-16 w-16 text-gray-300 dark:text-gray-600 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                    <p className="text-gray-500 dark:text-gray-400 text-lg">No messages yet</p>
                    <p className="text-gray-400 dark:text-gray-500 text-sm">Start the conversation!</p>
                  </div>
                </div>
              )}
              {messages.map((message: Message) => (
                <div key={message.id} id={`msg-${message.id}`}>
                  <MessageBubble
                    message={message}
                    currentUserId={userId}
                    isHovered={hoveredMessageId === message.id}
                    onMouseEnter={() => setHoveredMessageId(message.id)}
                    onMouseLeave={() => setTimeout(() => setHoveredMessageId(null), 200)}
                    onReact={(type) => onAddReaction(message.id, type)}
                  />
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="border-t border-gray-200 dark:border-gray-700 p-4 flex-shrink-0 bg-white dark:bg-gray-800 transition-colors duration-300">
              <form onSubmit={onSendMessage} className="space-y-2">
                <div className="flex gap-2">
                  <button 
                    type="button" 
                    onClick={onImageUpload} 
                    disabled={isUploading} 
                    className="bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 px-3 py-2 rounded-xl transition-all flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Send image (max 2MB) - You can also paste images"
                  >
                    {isUploading ? (
                      <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                    ) : (
                      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    )}
                  </button>
                  <input 
                    ref={fileInputRef} 
                    type="file" 
                    accept="image/jpeg,image/png,image/gif,image/webp" 
                    onChange={onFileSelect}
                    className="hidden" 
                  />
                  <input
                    ref={inputRef}
                    type="text"
                    value={inputMessage}
                    onChange={(e) => setInputMessage(e.target.value)}
                    onFocus={updateUserActivity}
                    onClick={updateUserActivity}
                    onPaste={onPaste}
                    placeholder="Type a message or paste an image..."
                    className="flex-1 px-4 py-2 border-2 border-gray-200 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm transition-all bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    maxLength={500}
                  />
                  <button 
                    type="submit" 
                    className="bg-blue-500 text-white px-5 py-2 rounded-xl hover:bg-blue-600 transition-all font-medium text-sm flex-shrink-0 shadow-md"
                  >
                    Send
                  </button>
                </div>
                <div className="text-xs text-gray-400 dark:text-gray-500 px-1 flex items-center gap-1">
                  <span>📷</span>
                  <span>Click the camera icon or paste an image (Ctrl+V / Cmd+V) to share (max 2MB)</span>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// SUB-COMPONENTS
// ============================================================
function StatusIcon({ status }: { status: MessageStatus }) {
  const configs = {
    sending: {
      color: "text-gray-500 dark:text-gray-400",
      label: "Sending...",
      icon: (
        <svg className="animate-spin h-2 w-2 sm:h-3 sm:w-3" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
      ),
    },
    sent: {
      color: "text-blue-500",
      label: "Sent",
      icon: (
        <svg className="h-2 w-2 sm:h-3 sm:w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      ),
    },
    delivered: {
      color: "text-green-500",
      label: "Delivered",
      icon: (
        <svg className="h-2 w-2 sm:h-3 sm:w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
    error: {
      color: "text-red-500",
      label: "Failed",
      icon: (
        <svg className="h-2 w-2 sm:h-3 sm:w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
  };
  const { color, label, icon } = configs[status];
  return (
    <div className={`flex items-center gap-0.5 text-[8px] sm:text-xs ${color}`}>
      {icon}
      <span className="hidden sm:inline">{label}</span>
      <span className="sm:hidden">{label === "Sending..." ? "..." : label.charAt(0)}</span>
    </div>
  );
}

function ReactionPicker({
  reactions,
  userId,
  onReact,
}: {
  reactions?: Reaction[];
  userId: string;
  onReact: (type: ReactionType) => void;
}) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg border dark:border-gray-700 p-0.5 sm:p-1 flex gap-0 z-20">
      {REACTIONS.map((reaction) => {
        const isActive = sanitizeReactions(reactions || []).some(
          (r) => r.userId === userId && r.type === reaction
        );
        return (
          <button
            key={reaction}
            onClick={() => onReact(reaction)}
            className={`hover:bg-gray-100 dark:hover:bg-gray-700 p-0.5 sm:p-1 rounded transition-colors text-xs sm:text-base ${
              isActive ? "bg-blue-100 dark:bg-blue-900" : ""
            }`}
          >
            {reaction}
          </button>
        );
      })}
    </div>
  );
}

function ReactionDisplay({
  reactions,
  userId,
}: {
  reactions?: Reaction[];
  userId: string;
}) {
  const counts = getReactionCounts(reactions);
  const unique = getUniqueReactions(reactions);
  if (unique.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-0.5 justify-end">
      {unique.map((reaction, idx) => {
        const isActive = sanitizeReactions(reactions || []).some(
          (r) => r.userId === userId && r.type === reaction.type
        );
        return (
          <div
            key={idx}
            className={`inline-flex items-center gap-0.5 bg-white dark:bg-gray-800 border rounded-full px-[2px] py-[1px] sm:px-1 sm:py-0.5 text-[8px] sm:text-xs shadow-md ${
              isActive ? "border-blue-500 bg-blue-50 dark:bg-blue-900/50" : "border-gray-300 dark:border-gray-600"
            }`}
          >
            <span className="text-[10px] sm:text-sm">{reaction.type}</span>
            <span className="text-[8px] sm:text-xs text-gray-600 dark:text-gray-400">{counts[reaction.type]}</span>
          </div>
        );
      })}
    </div>
  );
}

function MessageBubble({
  message,
  currentUserId,
  isHovered,
  onMouseEnter,
  onMouseLeave,
  onReact,
}: {
  message: Message;
  currentUserId: string;
  isHovered: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onReact: (type: ReactionType) => void;
}) {
  const isOwn = message.userId === currentUserId;
  const uniqueReactions = getUniqueReactions(message.reactions);
  const hasReactions = uniqueReactions.length > 0;
  const isImage = message.type === "image";
  const [imageLoaded, setImageLoaded] = useState(false);
  
  return (
    <div className={`flex ${isOwn ? "justify-end" : "justify-start"} ${hasReactions ? 'mb-7' : 'mb-3'}`}>
      <div
        className={`relative max-w-[85%] sm:max-w-[70%] md:max-w-[60%] min-w-[40px] ${isOwn ? 'mr-2' : 'ml-2'}`}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        {isHovered && (
          <div className={`absolute -top-8 ${isOwn ? "right-0" : "left-0"} z-10`}>
            <ReactionPicker
              reactions={message.reactions}
              userId={currentUserId}
              onReact={onReact}
            />
          </div>
        )}
        <div
          className={`rounded-2xl p-2.5 sm:p-3 ${
            isOwn 
              ? "bg-blue-500 text-white shadow-md" 
              : "bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 shadow-sm"
          } overflow-hidden`}
        >
          <div className="flex items-center gap-2 mb-1">
            <span className={`font-semibold text-xs sm:text-sm truncate max-w-[150px] ${isOwn ? 'text-white' : 'text-gray-700 dark:text-gray-300'}`}>
              {message.username}
            </span>
            <span className={`text-[10px] sm:text-xs ${isOwn ? 'text-blue-100' : 'text-gray-500 dark:text-gray-400'} flex-shrink-0`}>
              {formatTime(message.timestamp)}
            </span>
          </div>
          
          {isImage && message.imageUrl ? (
            <div className="relative group">
              {message.imageThumbnail && !imageLoaded && (
                <div className="absolute inset-0 flex items-center justify-center bg-gray-100 dark:bg-gray-600 rounded-lg">
                  <div className="animate-pulse w-full h-full flex items-center justify-center">
                    <img
                      src={message.imageThumbnail}
                      alt="Loading thumbnail"
                      className="max-w-full max-h-[200px] rounded-lg blur-sm"
                      style={{ maxWidth: '100%', height: 'auto' }}
                    />
                  </div>
                </div>
              )}
              <img
                src={message.imageUrl}
                alt="Shared image"
                className="max-w-full max-h-[300px] rounded-lg cursor-pointer"
                onClick={() => window.open(message.imageUrl, '_blank')}
                onLoad={() => setImageLoaded(true)}
                style={{ maxWidth: '100%', height: 'auto' }}
              />
            </div>
          ) : (
            <p className="break-words whitespace-pre-wrap text-sm sm:text-base overflow-hidden">
              {message.text}
            </p>
          )}
          
          {isOwn && message.status && (
            <div className="mt-1 flex justify-end">
              <StatusIcon status={message.status} />
            </div>
          )}
        </div>
        {hasReactions && (
          <div className={`absolute -bottom-4 ${isOwn ? "right-0" : "left-0"} z-5`}>
            <div className="translate-y-2">
              <ReactionDisplay
                reactions={message.reactions}
                userId={currentUserId}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function UserListItem({
  user,
  isCurrentUser,
}: {
  user: User;
  isCurrentUser: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-3 p-3 hover:bg-gray-50 dark:hover:bg-gray-700 transition-all cursor-pointer ${
        isCurrentUser ? "bg-blue-50 dark:bg-blue-900/50" : ""
      }`}
    >
      <div className="relative flex-shrink-0">
        <div
          className={`w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-semibold shadow-md ${
            isCurrentUser
              ? "bg-green-500"
              : "bg-blue-500"
          }`}
        >
          {user.username?.charAt(0).toUpperCase()}
        </div>
        <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 rounded-full border-2 border-white dark:border-gray-800 animate-pulse" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 truncate">
          {user.username}
          {isCurrentUser && (
            <span className="ml-2 text-xs text-green-600 dark:text-green-400 font-normal">(You)</span>
          )}
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
          <span className="w-1.5 h-1.5 bg-green-500 rounded-full"></span>
          Active now
        </p>
      </div>
    </div>
  );
}

// ============================================================
// MAIN COMPONENT
// ============================================================
export default function Home() {
  const { theme, toggleTheme } = useTheme();
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState("");
  const [username, setUsername] = useState("");
  const [isJoined, setIsJoined] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(true);
  const [showLoadMoreButton, setShowLoadMoreButton] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState<User[]>([]);
  const [hoveredMessageId, setHoveredMessageId] = useState<string | null>(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isUserScrolled, setIsUserScrolled] = useState(false);
  const [newMessageCount, setNewMessageCount] = useState(0);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const userIdRef = useRef<string>(generateId());
  const usernameRef = useRef<string>("");
  const userHeartbeatRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const activityTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);

  // ── Load and Combine Messages Function ─────────────────────────────────
  const loadAndCombineMessages = async (limit?: number, beforeTimestamp?: number): Promise<Message[]> => {
    try {
      const [messagesData, imagesData] = await Promise.all([
        api.getAllMessages(),
        api.getAllImages()
      ]);
      
      const allMessages: Message[] = [];
      
      for (const [id, msg] of Object.entries(messagesData)) {
        const messageData = msg as any;
        if (messageData?.text && messageData?.username) {
          const message: Message = {
            id: id,
            text: messageData.text,
            username: messageData.username,
            timestamp: messageData.timestamp || Date.now(),
            userId: messageData.userId || "",
            status: "delivered" as MessageStatus,
            reactions: sanitizeReactions(messageData.reactions || []),
            type: messageData.type || "text",
            imageId: messageData.imageId,
          };
          
          if (message.type === "image" && message.imageId && imagesData && imagesData[message.imageId]) {
            const imageData = imagesData[message.imageId] as any;
            if (imageData && imageData.full && imageData.thumbnail) {
              message.imageUrl = imageData.full;
              message.imageThumbnail = imageData.thumbnail;
            }
          }
          
          allMessages.push(message);
        }
      }
      
      allMessages.sort((a, b) => b.timestamp - a.timestamp);
      
      let filteredMessages = allMessages;
      if (beforeTimestamp) {
        filteredMessages = allMessages.filter(m => m.timestamp < beforeTimestamp);
      }
      
      if (limit && limit > 0) {
        filteredMessages = filteredMessages.slice(0, limit);
      }
      
      return filteredMessages.reverse();
      
    } catch (err) {
      console.error("Error loading and combining messages:", err);
      return [];
    }
  };

  // ── Load Initial Messages ───────────────────────────────────────────
  const loadMessages = async () => {
    setIsLoading(true);
    try {
      const loadedMessages = await loadAndCombineMessages(MESSAGES_PER_PAGE);
      setMessages(loadedMessages);
      
      if (loadedMessages.length > 0) {
        const olderMessages = await loadAndCombineMessages(1, loadedMessages[0]?.timestamp);
        setHasMoreMessages(olderMessages.length > 0);
      } else {
        setHasMoreMessages(false);
      }
      
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
      }, 100);
    } catch (err) {
      console.error("Error loading messages:", err);
    } finally {
      setIsLoading(false);
    }
  };

  // ── Load More Messages ──────────────────────────────────────────────
  const loadMoreMessages = async () => {
    if (isLoadingMore || !hasMoreMessages || messages.length === 0) return;
    
    setIsLoadingMore(true);
    try {
      const oldestMessage = messages[0];
      if (!oldestMessage) return;
      
      const olderMessages = await loadAndCombineMessages(MESSAGES_PER_PAGE, oldestMessage.timestamp);
      
      if (olderMessages.length === 0) {
        setHasMoreMessages(false);
      } else {
        const scrollHeightBefore = messagesContainerRef.current?.scrollHeight || 0;
        const scrollTopBefore = messagesContainerRef.current?.scrollTop || 0;
        
        setMessages(prev => [...olderMessages, ...prev]);
        
        const evenOlderMessages = await loadAndCombineMessages(1, olderMessages[0]?.timestamp);
        setHasMoreMessages(evenOlderMessages.length > 0);
        
        setTimeout(() => {
          if (messagesContainerRef.current) {
            const newScrollHeight = messagesContainerRef.current.scrollHeight;
            const heightDifference = newScrollHeight - scrollHeightBefore;
            messagesContainerRef.current.scrollTop = scrollTopBefore + heightDifference;
          }
          setShowLoadMoreButton(false);
        }, 100);
      }
    } catch (err) {
      console.error("Error loading more messages:", err);
    } finally {
      setIsLoadingMore(false);
    }
  };

  // ── User Presence Functions ─────────────────────────────────────────
  const updateLastActive = async () => {
    if (!isJoined) return;
    try {
      await api.patchUser(userIdRef.current, { lastActive: Date.now() });
    } catch (err) {
      console.error("Error updating last active:", err);
    }
  };

  const loadOnlineUsers = async () => {
    try {
      const res = await api.getUsers();
      const data: Record<string, any> = await res.json();
      const now = Date.now();
      const active: User[] = [];
      Object.entries(data || {}).forEach(([key, user]) => {
        if (!user?.username || !user?.lastActive) return;
        if (now - user.lastActive < USER_ACTIVE_THRESHOLD) {
          active.push({
            id: key,
            username: user.username,
            joinedAt: user.joinedAt || now,
            lastActive: user.lastActive,
          });
        } else {
          api.deleteUser(key).catch(console.error);
        }
      });
      active.sort((a, b) => {
        if (a.id === userIdRef.current) return -1;
        if (b.id === userIdRef.current) return 1;
        return a.username.localeCompare(b.username);
      });
      setOnlineUsers(active);
    } catch (err) {
      console.error("Error loading online users:", err);
    }
  };

  const updateUserActivity = () => {
    if (!isJoined) return;
    if (activityTimeoutRef.current) {
      clearTimeout(activityTimeoutRef.current);
    }
    updateLastActive();
    activityTimeoutRef.current = setTimeout(() => {}, 120000);
  };

  // ── Effects for activity tracking ───────────────────────────────────
  useEffect(() => {
    if (!isJoined) return;
    const events = ['mousedown', 'keydown', 'scroll', 'touchstart'];
    const handleUserActivity = () => updateUserActivity();
    events.forEach(event => {
      window.addEventListener(event, handleUserActivity);
    });
    updateUserActivity();
    return () => {
      events.forEach(event => {
        window.removeEventListener(event, handleUserActivity);
      });
      if (activityTimeoutRef.current) {
        clearTimeout(activityTimeoutRef.current);
      }
    };
  }, [isJoined]);

  useEffect(() => {
    const savedUsername = localStorage.getItem("chat-username");
    const savedUserId = localStorage.getItem("chat-userId");
    if (savedUsername && savedUserId) {
      setUsername(savedUsername);
      usernameRef.current = savedUsername;
      userIdRef.current = savedUserId;
      setIsJoined(true);
    }
  }, []);

  // ── Scroll Detection ─────────────────────────────────────────────────
  const handleScroll = () => {
    if (!messagesContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = messagesContainerRef.current;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 100;
    const isNearTop = scrollTop < 50;
    setIsUserScrolled(!isNearBottom);
    setShowScrollButton(!isNearBottom && scrollHeight > clientHeight);
    if (isNearBottom && newMessageCount > 0) {
      setNewMessageCount(0);
    }
    if (isNearTop && hasMoreMessages && !isLoadingMore && messages.length > 0) {
      setShowLoadMoreButton(true);
    } else if (!isNearTop) {
      setShowLoadMoreButton(false);
    }
    updateUserActivity();
  };

  // ── User Presence Registration ──────────────────────────────────────
  const registerUser = async () => {
    try {
      await api.putUser(userIdRef.current, {
        username: usernameRef.current,
        joinedAt: Date.now(),
        lastActive: Date.now(),
      });
      setTimeout(loadOnlineUsers, 1000);
    } catch (err) {
      console.error("Error registering user:", err);
    }
  };

  const removeUser = async () => {
    try {
      await api.deleteUser(userIdRef.current);
    } catch (err) {
      console.error("Error removing user:", err);
    }
  };

  // ── Main Effects ────────────────────────────────────────────────────
  useEffect(() => {
    if (!isJoined) return;
    registerUser();
    loadMessages();
    userHeartbeatRef.current = setInterval(() => {
      updateLastActive();
      loadOnlineUsers();
    }, HEARTBEAT_INTERVAL);
    return () => {
      clearInterval(userHeartbeatRef.current);
      removeUser();
    };
  }, [isJoined]);

  useEffect(() => {
    if (!isJoined) return;
    const interval = setInterval(loadOnlineUsers, USER_REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [isJoined]);

  useEffect(() => {
    if (!isUserScrolled && messagesEndRef.current && messages.length > 0 && !isLoadingMore) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isUserScrolled, isLoadingMore]);

  // ── Image Upload Function ───────────────────────────────────────────
  const handleImageUpload = async (file: File) => {
    if (!file) return;
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      alert("Please upload a valid image (JPEG, PNG, GIF, or WEBP)");
      return;
    }
    if (file.size > MAX_IMAGE_SIZE) {
      alert("Image must be less than 2MB");
      return;
    }
    
    setIsUploading(true);
    updateUserActivity();
    await updateLastActive();
    const messageId = generateId();
    
    const currentUsername = usernameRef.current;
    if (!currentUsername) {
      alert("Username not found");
      setIsUploading(false);
      return;
    }
    
    try {
      const { full, thumbnail } = await processImage(file);
      const uploadRes = await fetch("/api/upload-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageData: { full, thumbnail },
          messageId: messageId,
        }),
      });
      
      if (!uploadRes.ok) {
        throw new Error("Failed to upload image");
      }
      
      const newMessage: Message = {
        id: messageId,
        text: "📷 Image",
        username: currentUsername,
        timestamp: Date.now(),
        userId: userIdRef.current,
        status: "sending",
        reactions: [],
        type: "image",
        imageId: messageId,
        imageUrl: full,
        imageThumbnail: thumbnail,
      };
      
      const updateStatus = (status: MessageStatus | undefined) =>
        setMessages((prev) =>
          prev.map((msg) => (msg.id === messageId ? { ...msg, status } : msg))
        );
      
      setMessages((prev) => {
        if (prev.some((m) => m.id === messageId)) return prev;
        return [...prev, newMessage].sort((a, b) => a.timestamp - b.timestamp);
      });
      
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 100);
      
      try {
        updateStatus("sent");
        const messageToSend = { ...newMessage };
        delete (messageToSend as any).imageUrl;
        delete (messageToSend as any).imageThumbnail;
        const res = await api.sendMessage(messageToSend);
        if (res.ok) {
          updateStatus("delivered");
          setTimeout(() => updateStatus(undefined), STATUS_CLEAR_DELAY);
        } else {
          updateStatus("error");
          console.error("Failed to send image message:", await res.text());
        }
      } catch (err) {
        console.error("Error sending image message:", err);
        updateStatus("error");
      }
      
      setIsUserScrolled(false);
      setShowScrollButton(false);
    } catch (err) {
      console.error("Error processing image:", err);
      alert("Failed to process image. Please try again.");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  // ── Handle File Select ──────────────────────────────────────────────
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleImageUpload(file);
    }
  };

  // ── Handle Paste Event ──────────────────────────────────────────────
  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      
      if (item.type.indexOf("image") !== -1) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          await handleImageUpload(file);
        }
        break;
      }
    }
  };

  // ── Send Text Message ───────────────────────────────────────────────
  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputMessage.trim()) return;
    
    const currentUsername = usernameRef.current;
    if (!currentUsername) return;
    
    updateUserActivity();
    await updateLastActive();
    const messageId = generateId();
    const newMessage: Message = {
      id: messageId,
      text: inputMessage,
      username: currentUsername,
      timestamp: Date.now(),
      userId: userIdRef.current,
      status: "sending",
      reactions: [],
      type: "text",
    };
    setInputMessage("");
    const updateStatus = (status: MessageStatus | undefined) =>
      setMessages((prev) =>
        prev.map((msg) => (msg.id === messageId ? { ...msg, status } : msg))
      );
    setMessages((prev) => {
      if (prev.some((m) => m.id === messageId)) return prev;
      return [...prev, newMessage].sort((a, b) => a.timestamp - b.timestamp);
    });
    try {
      updateStatus("sent");
      const res = await api.sendMessage(newMessage);
      if (res.ok) {
        updateStatus("delivered");
        setTimeout(() => updateStatus(undefined), STATUS_CLEAR_DELAY);
      } else {
        updateStatus("error");
      }
    } catch (err) {
      console.error("Error sending message:", err);
      updateStatus("error");
    }
    setIsUserScrolled(false);
    setShowScrollButton(false);
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 100);
  };

  // ── Pusher Real-time ────────────────────────────────────────────────
  useEffect(() => {
    if (!isJoined) return;
    
    const pusher = new Pusher("bc4bbe143420c20c0e9d", {
      cluster: "ap1",
      authEndpoint: "/api/pusher-auth",
    });
    const channel = pusher.subscribe("private-chat-channel");
    
    channel.bind("new-message", async (data: any) => {
      console.log("Received new message via Pusher:", data);
      
      let imageUrl = undefined;
      let imageThumbnail = undefined;
      
      if (data.type === "image" && data.imageId) {
        const imageData = await fetchImage(data.imageId);
        if (imageData) {
          imageUrl = imageData.full;
          imageThumbnail = imageData.thumbnail;
        }
      }
      
      setMessages((prev) => {
        if (prev.some((m) => m.id === data.id)) return prev;
        
        const newMessage: Message = {
          ...data,
          status: "delivered" as MessageStatus,
          imageUrl,
          imageThumbnail,
        };
        
        const newMessages = [...prev, newMessage].sort(
          (a, b) => a.timestamp - b.timestamp
        );
        
        if (isUserScrolled) {
          setNewMessageCount(prev => prev + 1);
        } else {
          setTimeout(() => {
            messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
          }, 100);
        }
        
        return newMessages;
      });
    });
    
    channel.bind("message-reaction", (data: { messageId: string; reaction: Reaction | null }) => {
      if (!data.reaction) return;
      setMessages((prev) =>
        prev.map((msg) => {
          if (msg.id !== data.messageId) return msg;
          const alreadyExists = msg.reactions?.some(
            (r) => r?.userId === data.reaction!.userId && r?.type === data.reaction!.type
          );
          if (alreadyExists) return msg;
          return {
            ...msg,
            reactions: [...sanitizeReactions(msg.reactions), data.reaction!],
          };
        })
      );
    });
    
    return () => {
      channel.unbind_all();
      channel.unsubscribe();
      pusher.disconnect();
    };
  }, [isJoined, isUserScrolled]);

  // ── Reactions ───────────────────────────────────────────────────────
  const addReaction = async (messageId: string, reactionType: ReactionType) => {
    updateUserActivity();
    const message = messages.find((m) => m.id === messageId);
    const cleanReactions = sanitizeReactions(message?.reactions || []);
    const hasReacted = cleanReactions.some(
      (r) => r.userId === userIdRef.current && r.type === reactionType
    );
    const updatedReactions = hasReacted
      ? cleanReactions.filter((r) => !(r.userId === userIdRef.current && r.type === reactionType))
      : [...cleanReactions, { type: reactionType, userId: userIdRef.current, username: usernameRef.current, timestamp: Date.now() }];
    setMessages((prev) =>
      prev.map((msg) => (msg.id === messageId ? { ...msg, reactions: updatedReactions } : msg))
    );
    try {
      await api.putReactions(messageId, updatedReactions);
      await api.sendReaction(messageId, hasReacted ? null : updatedReactions[updatedReactions.length - 1]);
    } catch (err) {
      console.error("Error updating reaction:", err);
    }
    setHoveredMessageId(null);
  };

  const scrollToBottom = () => {
    setNewMessageCount(0);
    setIsUserScrolled(false);
    setShowScrollButton(false);
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    updateUserActivity();
  };

  const joinChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) return;
    usernameRef.current = username;
    localStorage.setItem("chat-username", username);
    localStorage.setItem("chat-userId", userIdRef.current);
    setIsJoined(true);
  };

  const clearSavedUser = () => {
    localStorage.removeItem("chat-username");
    localStorage.removeItem("chat-userId");
    setUsername("");
    usernameRef.current = "";
    window.location.reload();
  };

  const handleUsernameChange = (value: string) => {
    setUsername(value);
    usernameRef.current = value;
  };

  const handleImageButtonClick = () => {
    fileInputRef.current?.click();
  };

  // ── Render ──────────────────────────────────────────────────────────
  if (!isJoined) {
    return (
      <JoinScreen
        username={username}
        onUsernameChange={handleUsernameChange}
        onSubmit={joinChat}
        theme={theme}
        toggleTheme={toggleTheme}
      />
    );
  }

  return (
    <ChatScreen
      messages={messages}
      inputMessage={inputMessage}
      setInputMessage={setInputMessage}
      username={username}
      onlineUsers={onlineUsers}
      hoveredMessageId={hoveredMessageId}
      setHoveredMessageId={setHoveredMessageId}
      isMobileMenuOpen={isMobileMenuOpen}
      setIsMobileMenuOpen={setIsMobileMenuOpen}
      isUserScrolled={isUserScrolled}
      showScrollButton={showScrollButton}
      newMessageCount={newMessageCount}
      showLoadMoreButton={showLoadMoreButton}
      hasMoreMessages={hasMoreMessages}
      isLoading={isLoading}
      isLoadingMore={isLoadingMore}
      isUploading={isUploading}
      userId={userIdRef.current}
      messagesEndRef={messagesEndRef}
      messagesContainerRef={messagesContainerRef}
      fileInputRef={fileInputRef}
      inputRef={inputRef}
      onSendMessage={sendMessage}
      onLoadMoreMessages={loadMoreMessages}
      onAddReaction={addReaction}
      onScrollToBottom={scrollToBottom}
      onClearSavedUser={clearSavedUser}
      onImageUpload={handleImageButtonClick}
      onFileSelect={handleFileSelect}
      onPaste={handlePaste}
      onScroll={handleScroll}
      updateUserActivity={updateUserActivity}
      theme={theme}
      toggleTheme={toggleTheme}
    />
  );
}
