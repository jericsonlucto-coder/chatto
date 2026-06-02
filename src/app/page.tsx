"use client";
import NextImage from "next/image";
import { useState, useEffect, useRef, useCallback } from "react";
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
interface Mention {
  userId: string;
  username: string;
  startIndex: number;
  endIndex: number;
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
  mentions?: Mention[];
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
const CONFIG = {
  FIREBASE_DB_URL: "https://chatto-659ec-default-rtdb.firebaseio.com",
  PUSHER_KEY: "bc4bbe143420c20c0e9d",
  PUSHER_CLUSTER: "ap1",
  REACTIONS: ["👍", "❤️", "😂", "😮", "😢", "🙏"] as ReactionType[],
  HEARTBEAT_INTERVAL: 30000,
  USER_ACTIVE_THRESHOLD: 60000,
  USER_REFRESH_INTERVAL: 5000,
  STATUS_CLEAR_DELAY: 2000,
  MESSAGES_PER_PAGE: 50,
  MAX_IMAGE_SIZE: 2 * 1024 * 1024,
  ALLOWED_IMAGE_TYPES: ["image/jpeg", "image/png", "image/gif", "image/webp"],
  MENTION_SOUND_URL: "/sounds/mention.mp3",
  MESSAGES_CACHE_KEY: "chat-messages-cache",
  MESSAGES_CACHE_TIMESTAMP_KEY: "chat-messages-timestamp",
  CACHE_DURATION: 5 * 60 * 1000,
};

// ============================================================
// UTILITIES
// ============================================================
const utils = {
  generateId: () =>
    Date.now().toString(36) + Math.random().toString(36).substring(2, 9),
  formatTime: (timestamp: number) =>
    new Date(timestamp).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    }),
  sanitizeReactions: (reactions: Reaction[] | undefined): Reaction[] =>
    (reactions || []).filter((r) => r !== null && r !== undefined),
  getReactionCounts: (reactions?: Reaction[]): Record<string, number> => {
    if (!reactions) return {};
    return utils.sanitizeReactions(reactions).reduce((acc, r) => {
      acc[r.type] = (acc[r.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
  },
  getUniqueReactions: (reactions?: Reaction[]): Reaction[] => {
    if (!reactions) return [];
    const unique = new Map<ReactionType, Reaction>();
    utils.sanitizeReactions(reactions).forEach((r) => {
      if (!unique.has(r.type)) unique.set(r.type, r);
    });
    return Array.from(unique.values());
  },
  processImage: (file: File): Promise<{ full: string; thumbnail: string }> => {
    return new Promise((resolve, reject) => {
      const img = document.createElement("img");
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
        canvas.getContext("2d")?.drawImage(img, 0, 0, width, height);
        const full = canvas.toDataURL("image/jpeg", 0.7);
        let thumbWidth = img.width;
        let thumbHeight = img.height;
        if (thumbWidth > 150) {
          thumbHeight = (thumbHeight * 150) / thumbWidth;
          thumbWidth = 150;
        }
        thumbCanvas.width = thumbWidth;
        thumbCanvas.height = thumbHeight;
        thumbCanvas
          .getContext("2d")
          ?.drawImage(img, 0, 0, thumbWidth, thumbHeight);
        const thumbnail = thumbCanvas.toDataURL("image/jpeg", 0.5);
        resolve({ full, thumbnail });
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  },
  parseMentions: (
    text: string,
    users: User[],
    currentUserId: string
  ): { text: string; mentions: Mention[] } => {
    const mentions: Mention[] = [];
    const processedText = text;
    if (text.includes("@everyone")) {
      mentions.push({
        userId: "everyone",
        username: "everyone",
        startIndex: text.indexOf("@everyone"),
        endIndex: text.indexOf("@everyone") + 9,
      });
    }
    const mentionRegex = /@(\w+)/g;
    let match;
    while ((match = mentionRegex.exec(text)) !== null) {
      const mentionedUsername = match[1];
      if (mentionedUsername.toLowerCase() === "everyone") continue;
      const user = users.find(
        (u) => u.username.toLowerCase() === mentionedUsername.toLowerCase()
      );
      if (user && user.id !== currentUserId) {
        mentions.push({
          userId: user.id,
          username: user.username,
          startIndex: match.index,
          endIndex: match.index + match[0].length,
        });
      }
    }
    return { text: processedText, mentions };
  },
  highlightMentions: (
    text: string,
    currentUserId: string,
    onlineUsers: User[]
  ): React.ReactNode => {
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    const mentionRegex = /@(\w+)/g;
    let match;
    const currentUser = onlineUsers.find((u) => u.id === currentUserId);
    const currentUsername = currentUser?.username?.toLowerCase() ?? "";
    while ((match = mentionRegex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push(text.substring(lastIndex, match.index));
      }
      const mentionedUsername = match[1];
      const mentionedLower = mentionedUsername.toLowerCase();
      const isEveryone = mentionedLower === "everyone";
      const isMentioningMe =
        !isEveryone &&
        currentUsername !== "" &&
        mentionedLower === currentUsername;
      const userExists = onlineUsers.some(
        (u) => u.username.toLowerCase() === mentionedLower
      );
      parts.push(
        <span
          key={match.index}
          className={`font-semibold rounded px-0.5 ${
            isEveryone
              ? "bg-yellow-100 dark:bg-yellow-900/50 text-yellow-700 dark:text-yellow-300"
              : isMentioningMe
              ? "bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300"
              : userExists
              ? "bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 cursor-pointer hover:underline"
              : "bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400"
          }`}
        >
          @{mentionedUsername}
        </span>
      );
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) {
      parts.push(text.substring(lastIndex));
    }
    return parts.length > 0 ? parts : text;
  },
  isUserMentioned: (
    message: Message,
    currentUserId: string,
    currentUsername?: string
  ): boolean => {
    if (message.mentions && message.mentions.length > 0) {
      const mentionedById = message.mentions.some(
        (mention) =>
          mention.userId === currentUserId || mention.userId === "everyone"
      );
      if (mentionedById) return true;
      if (currentUsername) {
        const mentionedByName = message.mentions.some(
          (mention) =>
            mention.username.toLowerCase() === currentUsername.toLowerCase()
        );
        if (mentionedByName) return true;
      }
    }
    if (currentUsername) {
      const mentionRegex = /@(\w+)/g;
      let match;
      while ((match = mentionRegex.exec(message.text)) !== null) {
        const mentioned = match[1].toLowerCase();
        if (
          mentioned === currentUsername.toLowerCase() ||
          mentioned === "everyone"
        ) {
          return true;
        }
      }
    }
    return false;
  },
  saveMessagesToCache: (messages: Message[]) => {
    try {
      const messagesToCache = messages.slice(-CONFIG.MESSAGES_PER_PAGE);
      localStorage.setItem(CONFIG.MESSAGES_CACHE_KEY, JSON.stringify(messagesToCache));
      localStorage.setItem(CONFIG.MESSAGES_CACHE_TIMESTAMP_KEY, Date.now().toString());
    } catch (err) {
      console.error("Error saving messages to cache:", err);
    }
  },
  loadMessagesFromCache: (): Message[] | null => {
    try {
      const cached = localStorage.getItem(CONFIG.MESSAGES_CACHE_KEY);
      const timestamp = localStorage.getItem(CONFIG.MESSAGES_CACHE_TIMESTAMP_KEY);
      
      if (!cached || !timestamp) return null;
      
      const cacheTime = parseInt(timestamp);
      const now = Date.now();
      
      if (now - cacheTime > CONFIG.CACHE_DURATION) {
        localStorage.removeItem(CONFIG.MESSAGES_CACHE_KEY);
        localStorage.removeItem(CONFIG.MESSAGES_CACHE_TIMESTAMP_KEY);
        return null;
      }
      
      const messages = JSON.parse(cached);
      return messages;
    } catch (err) {
      console.error("Error loading messages from cache:", err);
      return null;
    }
  },
};

// ============================================================
// SOUND MANAGER
// ============================================================
const soundManager = {
  playMentionSound: () => {
    try {
      const audio = new Audio(CONFIG.MENTION_SOUND_URL);
      audio.volume = 0.5;
      audio.play().catch((err) => console.log("Audio play failed:", err));
    } catch (err) {
      console.error("Error playing mention sound:", err);
    }
  },
};

// ============================================================
// API SERVICE
// ============================================================
const apiService = {
  async getAllMessages(): Promise<Record<string, any>> {
    try {
      const res = await fetch(`${CONFIG.FIREBASE_DB_URL}/messages.json`);
      return (await res.json()) || {};
    } catch (err) {
      console.error("Error getting all messages:", err);
      return {};
    }
  },
  async getAllImages(): Promise<Record<string, any>> {
    try {
      const res = await fetch(`${CONFIG.FIREBASE_DB_URL}/images.json`);
      return (await res.json()) || {};
    } catch (err) {
      console.error("Error getting all images:", err);
      return {};
    }
  },
  async fetchImage(
    imageId: string
  ): Promise<{ full: string; thumbnail: string } | null> {
    try {
      const res = await fetch(
        `${CONFIG.FIREBASE_DB_URL}/images/${imageId}.json`
      );
      const data = await res.json();
      if (
        data &&
        typeof data === "object" &&
        "full" in data &&
        "thumbnail" in data
      ) {
        return data as { full: string; thumbnail: string };
      }
      return null;
    } catch (err) {
      console.error("Error fetching image:", err);
      return null;
    }
  },
  getUsers: () => fetch(`${CONFIG.FIREBASE_DB_URL}/users.json`),
  putUser: (userId: string, data: object) =>
    fetch(`${CONFIG.FIREBASE_DB_URL}/users/${userId}.json`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  patchUser: (userId: string, data: object) =>
    fetch(`${CONFIG.FIREBASE_DB_URL}/users/${userId}.json`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  deleteUser: (userId: string) =>
    fetch(`${CONFIG.FIREBASE_DB_URL}/users/${userId}.json`, {
      method: "DELETE",
    }),
  putReactions: (messageId: string, reactions: Reaction[]) =>
    fetch(
      `${CONFIG.FIREBASE_DB_URL}/messages/${messageId}/reactions.json`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reactions),
      }
    ),
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
  async checkUserExists(userId: string): Promise<boolean> {
    try {
      const res = await fetch(
        `${CONFIG.FIREBASE_DB_URL}/users/${userId}.json`
      );
      const data = await res.json();
      return data !== null && data !== undefined;
    } catch (err) {
      console.error("Error checking user:", err);
      return false;
    }
  },
  async getUser(userId: string): Promise<any | null> {
    try {
      const res = await fetch(
        `${CONFIG.FIREBASE_DB_URL}/users/${userId}.json`
      );
      return await res.json();
    } catch (err) {
      console.error("Error getting user:", err);
      return null;
    }
  },
};

// ============================================================
// HELPER - Persistent User ID
// ============================================================
const getOrCreateUserId = (): string => {
  if (typeof window === "undefined") return utils.generateId();
  const saved = localStorage.getItem("chat-userId");
  if (saved) return saved;
  const newId = utils.generateId();
  localStorage.setItem("chat-userId", newId);
  return newId;
};

// ============================================================
// UI COMPONENTS
// ============================================================

const LoadingNewMessages = () => (
  <div className="flex justify-center my-6">
    <div className="bg-gradient-to-r from-blue-500 to-indigo-500 text-white rounded-full px-6 py-3 flex items-center gap-3 shadow-lg">
      <svg
        className="animate-spin h-5 w-5"
        viewBox="0 0 24 24"
      >
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="4"
          fill="none"
        />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
        />
      </svg>
      <span className="text-sm font-semibold">
        Loading new messages...
      </span>
    </div>
  </div>
);

const StatusIcon = ({ status }: { status: MessageStatus }) => {
  const configs = {
    sending: {
      color: "text-gray-500 dark:text-gray-400",
      label: "Sending...",
      icon: (
        <svg
          className="animate-spin h-2 w-2 sm:h-3 sm:w-3"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
            fill="none"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
      ),
    },
    sent: {
      color: "text-blue-500",
      label: "Sent",
      icon: (
        <svg
          className="h-2 w-2 sm:h-3 sm:w-3"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M5 13l4 4L19 7"
          />
        </svg>
      ),
    },
    delivered: {
      color: "text-green-500",
      label: "Delivered",
      icon: (
        <svg
          className="h-2 w-2 sm:h-3 sm:w-3"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      ),
    },
    error: {
      color: "text-red-500",
      label: "Failed",
      icon: (
        <svg
          className="h-2 w-2 sm:h-3 sm:w-3"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      ),
    },
  };
  const { color, label, icon } = configs[status];
  return (
    <div
      className={`flex items-center gap-0.5 text-[8px] sm:text-xs ${color}`}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
      <span className="sm:hidden">
        {label === "Sending..." ? "..." : label.charAt(0)}
      </span>
    </div>
  );
};

const ReactionPicker = ({
  reactions,
  userId,
  onReact,
}: {
  reactions?: Reaction[];
  userId: string;
  onReact: (type: ReactionType) => void;
}) => (
  <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg border dark:border-gray-700 p-0.5 sm:p-1 flex gap-0 z-20">
    {CONFIG.REACTIONS.map((reaction) => {
      const isActive = utils
        .sanitizeReactions(reactions || [])
        .some((r) => r.userId === userId && r.type === reaction);
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

const ReactionDisplay = ({
  reactions,
  userId,
}: {
  reactions?: Reaction[];
  userId: string;
}) => {
  const counts = utils.getReactionCounts(reactions);
  const unique = utils.getUniqueReactions(reactions);
  if (unique.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-0.5 justify-end">
      {unique.map((reaction, idx) => {
        const isActive = utils
          .sanitizeReactions(reactions || [])
          .some((r) => r.userId === userId && r.type === reaction.type);
        return (
          <div
            key={idx}
            className={`inline-flex items-center gap-0.5 bg-white dark:bg-gray-800 border rounded-full px-[2px] py-[1px] sm:px-1 sm:py-0.5 text-[8px] sm:text-xs shadow-md ${
              isActive
                ? "border-blue-500 bg-blue-50 dark:bg-blue-900/50"
                : "border-gray-300 dark:border-gray-600"
            }`}
          >
            <span className="text-[10px] sm:text-sm">{reaction.type}</span>
            <span className="text-[8px] sm:text-xs text-gray-600 dark:text-gray-400">
              {counts[reaction.type]}
            </span>
          </div>
        );
      })}
    </div>
  );
};

const UnreadDivider = ({ count }: { count: number }) => (
  <div className="flex items-center gap-3 my-4 px-2 select-none">
    <div className="flex-1 h-px bg-red-400 dark:bg-red-500" />
    <div className="flex-shrink-0 flex items-center gap-1.5 bg-red-50 dark:bg-red-900/40 border border-red-300 dark:border-red-600 text-red-600 dark:text-red-400 text-xs font-semibold px-3 py-1 rounded-full shadow-sm">
      <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse inline-block" />
      {count} unread message{count !== 1 ? "s" : ""} below ↓
    </div>
    <div className="flex-1 h-px bg-red-400 dark:bg-red-500" />
  </div>
);

const MessageBubble = ({
  message,
  currentUserId,
  currentUsername,
  isHovered,
  onMouseEnter,
  onMouseLeave,
  onReact,
  onlineUsers,
  isNew,
}: {
  message: Message;
  currentUserId: string;
  currentUsername: string;
  isHovered: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onReact: (type: ReactionType) => void;
  onlineUsers: User[];
  isNew?: boolean;
}) => {
  const isOwn = message.userId === currentUserId;
  const uniqueReactions = utils.getUniqueReactions(message.reactions);
  const hasReactions = uniqueReactions.length > 0;
  const isImage = message.type === "image";
  const [imageLoaded, setImageLoaded] = useState(false);
  const isUserMentioned =
    !isOwn &&
    utils.isUserMentioned(message, currentUserId, currentUsername);

  return (
    <div
      className={`flex ${isOwn ? "justify-end" : "justify-start"} ${
        hasReactions ? "mb-7" : "mb-3"
      } items-start gap-2 ${isNew ? 'animate-slideInFromBottom' : ''}`}
    >
      <div
        className={`relative max-w-[85%] sm:max-w-[70%] md:max-w-[60%] min-w-[40px] ${
          isOwn ? "mr-2" : "ml-2"
        }`}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        {isHovered && (
          <div
            className={`absolute -top-8 ${
              isOwn ? "right-0" : "left-0"
            } z-10`}
          >
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
          <div className="flex items-center justify-between gap-2 mb-1">
            <span
              className={`font-semibold text-xs sm:text-sm truncate max-w-[150px] ${
                isOwn
                  ? "text-white"
                  : "text-gray-700 dark:text-gray-300"
              }`}
            >
              {message.username}
            </span>
            <span
              className={`text-[10px] sm:text-xs ${
                isOwn
                  ? "text-blue-100"
                  : "text-gray-500 dark:text-gray-400"
              } flex-shrink-0`}
            >
              {utils.formatTime(message.timestamp)}
            </span>
          </div>
          {isImage && message.imageUrl ? (
            <div className="relative group">
              {message.imageThumbnail && !imageLoaded && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <img
                    src={message.imageThumbnail}
                    alt="Loading"
                    className="max-w-full max-h-[300px] rounded-lg blur-sm"
                    style={{ maxWidth: "100%", height: "auto" }}
                  />
                </div>
              )}
              <img
                src={message.imageUrl}
                alt="Shared image"
                className={`max-w-full max-h-[300px] rounded-lg cursor-pointer transition-opacity duration-300 ${
                  imageLoaded ? "opacity-100" : "opacity-0"
                }`}
                onClick={() => window.open(message.imageUrl, "_blank")}
                onLoad={() => setImageLoaded(true)}
                style={{ maxWidth: "100%", height: "auto" }}
              />
            </div>
          ) : (
            <p className="break-words whitespace-pre-wrap text-sm sm:text-base overflow-hidden">
              {utils.highlightMentions(
                message.text,
                currentUserId,
                onlineUsers
              )}
            </p>
          )}
          {isOwn && message.status && (
            <div className="mt-1 flex justify-end">
              <StatusIcon status={message.status} />
            </div>
          )}
        </div>
        {hasReactions && (
          <div
            className={`absolute -bottom-4 ${
              isOwn ? "right-0" : "left-0"
            } z-5`}
          >
            <div className="translate-y-2">
              <ReactionDisplay
                reactions={message.reactions}
                userId={currentUserId}
              />
            </div>
          </div>
        )}
      </div>
      {isUserMentioned && !isOwn && (
        <div className="flex-shrink-0 self-center">
          <div className="bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center shadow-md">
            <span className="font-bold text-sm">!</span>
          </div>
        </div>
      )}
    </div>
  );
};

const UserListItem = ({
  user,
  isCurrentUser,
}: {
  user: User;
  isCurrentUser: boolean;
}) => (
  <div
    className={`flex items-center gap-3 p-3 hover:bg-gray-50 dark:hover:bg-gray-700 transition-all cursor-pointer ${
      isCurrentUser ? "bg-blue-50 dark:bg-blue-900/50" : ""
    }`}
  >
    <div className="relative flex-shrink-0">
      <div
        className={`w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-semibold shadow-md ${
          isCurrentUser ? "bg-green-500" : "bg-blue-500"
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
          <span className="ml-2 text-xs text-green-600 dark:text-green-400 font-normal">
            (You)
          </span>
        )}
      </p>
      <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
        <span className="w-1.5 h-1.5 bg-green-500 rounded-full" />
        Active now
      </p>
    </div>
  </div>
);

const JoinScreen = ({
  username,
  onUsernameChange,
  onSubmit,
  theme,
  toggleTheme,
}: {
  username: string;
  onUsernameChange: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  theme: Theme;
  toggleTheme: () => void;
}) => (
  <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 flex items-center justify-center p-4 transition-colors duration-300">
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-8 sm:p-10 max-w-md w-full transition-colors duration-300 relative">
      <button
        onClick={toggleTheme}
        className="absolute top-4 right-4 p-2 rounded-full bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
      >
        {theme === "light" ? (
          <svg
            className="w-5 h-5 text-gray-800 dark:text-gray-200"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
            />
          </svg>
        ) : (
          <svg
            className="w-5 h-5 text-yellow-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
            />
          </svg>
        )}
      </button>
      <div className="text-center mb-8">
        <div className="w-20 h-20 bg-blue-500 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg">
          <NextImage
            src="/next.svg"
            alt="Logo"
            width={50}
            height={50}
            className="brightness-0 invert"
          />
        </div>
        <h2 className="text-2xl sm:text-3xl font-bold text-gray-800 dark:text-white">
          Welcome to Chatto
        </h2>
        <p className="text-gray-500 dark:text-gray-400 mt-2 text-sm">
          Connect with friends in real-time
        </p>
      </div>
      <form onSubmit={onSubmit} className="space-y-6">
        <div>
          <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
            Username
          </label>
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

// ============================================================
// CUSTOM HOOKS
// ============================================================

const useTheme = () => {
  const [theme, setTheme] = useState<Theme>("light");
  useEffect(() => {
    const savedTheme = localStorage.getItem("theme") as Theme | null;
    const prefersDark = window.matchMedia(
      "(prefers-color-scheme: dark)"
    ).matches;
    const initialTheme = savedTheme || (prefersDark ? "dark" : "light");
    setTheme(initialTheme);
    document.documentElement.classList.toggle("dark", initialTheme === "dark");
  }, []);
  const toggleTheme = useCallback(() => {
    const newTheme = theme === "light" ? "dark" : "light";
    setTheme(newTheme);
    localStorage.setItem("theme", newTheme);
    document.documentElement.classList.toggle("dark", newTheme === "dark");
  }, [theme]);
  return { theme, toggleTheme };
};

const useMessages = () => {
  const [displayMessages, setDisplayMessages] = useState<Message[]>([]);
  const [cachedMessages, setCachedMessages] = useState<Message[]>([]);
  const [newMessagesFromApi, setNewMessagesFromApi] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(true);
  const [showLoadMoreButton, setShowLoadMoreButton] = useState(false);
  const [newMessageCount, setNewMessageCount] = useState(0);
  const [firstUnreadId, setFirstUnreadId] = useState<string | null>(null);
  const [isLoadingNewMessages, setIsLoadingNewMessages] = useState(false);
  const [showCachedOnly, setShowCachedOnly] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  const loadAndCombineMessages = useCallback(
    async (limit?: number, beforeTimestamp?: number): Promise<Message[]> => {
      try {
        const [messagesData, imagesData] = await Promise.all([
          apiService.getAllMessages(),
          apiService.getAllImages(),
        ]);
        const allMessages: Message[] = [];
        for (const [id, msg] of Object.entries(messagesData)) {
          const messageData = msg as any;
          if (messageData?.text && messageData?.username) {
            const message: Message = {
              id,
              text: messageData.text,
              username: messageData.username,
              timestamp: messageData.timestamp || Date.now(),
              userId: messageData.userId || "",
              status: "delivered" as MessageStatus,
              reactions: utils.sanitizeReactions(messageData.reactions || []),
              type: messageData.type || "text",
              imageId: messageData.imageId,
              mentions: messageData.mentions || [],
            };
            if (
              message.type === "image" &&
              message.imageId &&
              imagesData?.[message.imageId]
            ) {
              const imageData = imagesData[message.imageId];
              if (imageData?.full && imageData?.thumbnail) {
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
          filteredMessages = allMessages.filter(
            (m) => m.timestamp < beforeTimestamp
          );
        }
        if (limit && limit > 0) {
          filteredMessages = filteredMessages.slice(0, limit);
        }
        return filteredMessages.reverse();
      } catch (err) {
        console.error("Error loading messages:", err);
        return [];
      }
    },
    []
  );

  const loadMessages = useCallback(async () => {
    setIsLoading(true);
    
    // Step 1: Load cached messages first and display them immediately
    const cached = utils.loadMessagesFromCache();
    if (cached && cached.length > 0) {
      setCachedMessages(cached);
      setDisplayMessages(cached);
      setShowCachedOnly(true);
      // Show loading animation
      setIsLoadingNewMessages(true);
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
      }, 50);
    }
    
    // Step 2: Fetch fresh messages from API
    try {
      const freshMessages = await loadAndCombineMessages(
        CONFIG.MESSAGES_PER_PAGE
      );
      
      // Find new messages that are not in cache
      let newMessages: Message[] = [];
      if (cached && cached.length > 0) {
        const cachedIds = new Set(cached.map(m => m.id));
        newMessages = freshMessages.filter(m => !cachedIds.has(m.id));
      } else {
        newMessages = freshMessages;
      }
      
      setNewMessagesFromApi(newMessages);
      
      // Step 3: After loading, show all messages (cached + new)
      if (newMessages.length > 0) {
        // Keep loading animation visible while new messages are ready
        setTimeout(() => {
          setDisplayMessages(freshMessages);
          setShowCachedOnly(false);
          setIsLoadingNewMessages(false);
          // Save to cache
          utils.saveMessagesToCache(freshMessages);
          
          // Scroll to bottom to show new messages
          setTimeout(() => {
            messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
          }, 100);
        }, 1500); // Show loading animation for 1.5 seconds
      } else {
        // No new messages, just hide loading
        setDisplayMessages(freshMessages);
        setShowCachedOnly(false);
        setIsLoadingNewMessages(false);
        utils.saveMessagesToCache(freshMessages);
      }
      
      // Check for more older messages
      if (freshMessages.length > 0) {
        const olderMessages = await loadAndCombineMessages(
          1,
          freshMessages[0]?.timestamp
        );
        setHasMoreMessages(olderMessages.length > 0);
      } else {
        setHasMoreMessages(false);
      }
    } catch (err) {
      console.error("Error loading messages:", err);
      setIsLoadingNewMessages(false);
      setShowCachedOnly(false);
    } finally {
      setIsLoading(false);
    }
  }, [loadAndCombineMessages]);

  const loadMoreMessages = useCallback(async () => {
    if (isLoadingMore || !hasMoreMessages || displayMessages.length === 0) return;
    setIsLoadingMore(true);
    try {
      const oldestMessage = displayMessages[0];
      if (!oldestMessage) return;
      const olderMessages = await loadAndCombineMessages(
        CONFIG.MESSAGES_PER_PAGE,
        oldestMessage.timestamp
      );
      if (olderMessages.length === 0) {
        setHasMoreMessages(false);
      } else {
        const scrollHeightBefore =
          messagesContainerRef.current?.scrollHeight || 0;
        const scrollTopBefore =
          messagesContainerRef.current?.scrollTop || 0;
        const updatedMessages = [...olderMessages, ...displayMessages];
        setDisplayMessages(updatedMessages);
        const evenOlderMessages = await loadAndCombineMessages(
          1,
          olderMessages[0]?.timestamp
        );
        setHasMoreMessages(evenOlderMessages.length > 0);
        setTimeout(() => {
          if (messagesContainerRef.current) {
            const newScrollHeight =
              messagesContainerRef.current.scrollHeight;
            const heightDifference = newScrollHeight - scrollHeightBefore;
            messagesContainerRef.current.scrollTop =
              scrollTopBefore + heightDifference;
          }
          setShowLoadMoreButton(false);
        }, 100);
      }
    } catch (err) {
      console.error("Error loading more messages:", err);
    } finally {
      setIsLoadingMore(false);
    }
  }, [isLoadingMore, hasMoreMessages, displayMessages, loadAndCombineMessages]);

  useEffect(() => {
    if (!isLoading && displayMessages.length > 0 && !showCachedOnly) {
      utils.saveMessagesToCache(displayMessages);
    }
  }, [displayMessages, isLoading, showCachedOnly]);

  return {
    messages: displayMessages,
    setMessages: setDisplayMessages,
    isLoading,
    isLoadingMore,
    hasMoreMessages,
    showLoadMoreButton,
    setShowLoadMoreButton,
    newMessageCount,
    setNewMessageCount,
    firstUnreadId,
    setFirstUnreadId,
    messagesEndRef,
    messagesContainerRef,
    loadMessages,
    loadMoreMessages,
    isLoadingNewMessages,
    showCachedOnly,
  };
};

const useUserPresence = (isJoined: boolean, persistedUserId: string) => {
  const [onlineUsers, setOnlineUsers] = useState<User[]>([]);
  const userIdRef = useRef<string>(persistedUserId);
  const usernameRef = useRef<string>("");
  const userHeartbeatRef = useRef<NodeJS.Timeout | undefined>(undefined);

  const updateLastActive = useCallback(async () => {
    if (!isJoined || !userIdRef.current) return;
    try {
      const userExists = await apiService.checkUserExists(userIdRef.current);
      if (userExists) {
        await apiService.patchUser(userIdRef.current, {
          lastActive: Date.now(),
        });
      } else {
        await apiService.putUser(userIdRef.current, {
          username: usernameRef.current,
          joinedAt: Date.now(),
          lastActive: Date.now(),
        });
      }
    } catch (err) {
      console.error("Error updating last active:", err);
    }
  }, [isJoined]);

  const loadOnlineUsers = useCallback(async () => {
    try {
      const res = await apiService.getUsers();
      const data: Record<string, any> = await res.json();
      const now = Date.now();
      const active: User[] = [];
      Object.entries(data || {}).forEach(([key, user]) => {
        if (!user?.username || !user?.lastActive) return;
        if (now - user.lastActive < CONFIG.USER_ACTIVE_THRESHOLD) {
          active.push({
            id: key,
            username: user.username,
            joinedAt: user.joinedAt || now,
            lastActive: user.lastActive,
          });
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
  }, []);

  const registerOrRestoreUser = useCallback(async () => {
    if (!isJoined || !userIdRef.current) return;
    try {
      const userExists = await apiService.checkUserExists(userIdRef.current);
      const userData = userExists
        ? await apiService.getUser(userIdRef.current)
        : null;
      if (userExists && userData) {
        await apiService.patchUser(userIdRef.current, {
          lastActive: Date.now(),
        });
      } else {
        await apiService.putUser(userIdRef.current, {
          username: usernameRef.current,
          joinedAt: Date.now(),
          lastActive: Date.now(),
        });
      }
      setTimeout(loadOnlineUsers, 1000);
    } catch (err) {
      console.error("Error registering/restoring user:", err);
    }
  }, [isJoined, loadOnlineUsers]);

  const removeUser = useCallback(async () => {
    if (!userIdRef.current) return;
    try {
      await apiService.deleteUser(userIdRef.current);
    } catch (err) {
      console.error("Error removing user:", err);
    }
  }, []);

  useEffect(() => {
    if (!isJoined || !userIdRef.current) return;
    registerOrRestoreUser();
    userHeartbeatRef.current = setInterval(() => {
      updateLastActive();
      loadOnlineUsers();
    }, CONFIG.HEARTBEAT_INTERVAL);
    return () => {
      clearInterval(userHeartbeatRef.current);
      removeUser();
    };
  }, [
    isJoined,
    registerOrRestoreUser,
    loadOnlineUsers,
    updateLastActive,
    removeUser,
  ]);

  useEffect(() => {
    if (!isJoined) return;
    const interval = setInterval(
      loadOnlineUsers,
      CONFIG.USER_REFRESH_INTERVAL
    );
    return () => clearInterval(interval);
  }, [isJoined, loadOnlineUsers]);

  return {
    onlineUsers,
    userId: userIdRef.current,
    usernameRef,
    updateLastActive,
    loadOnlineUsers,
  };
};

const useImageUpload = (
  usernameRef: React.MutableRefObject<string>,
  userId: string,
  updateLastActive: () => Promise<void>,
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>,
  messagesEndRef: React.RefObject<HTMLDivElement | null>
) => {
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageUpload = useCallback(
    async (file: File) => {
      if (!file) return;
      if (!CONFIG.ALLOWED_IMAGE_TYPES.includes(file.type)) {
        alert("Please upload a valid image (JPEG, PNG, GIF, or WEBP)");
        return;
      }
      if (file.size > CONFIG.MAX_IMAGE_SIZE) {
        alert("Image must be less than 2MB");
        return;
      }
      setIsUploading(true);
      await updateLastActive();
      const messageId = utils.generateId();
      const currentUsername = usernameRef.current;
      if (!currentUsername) {
        alert("Username not found");
        setIsUploading(false);
        return;
      }
      try {
        const { full, thumbnail } = await utils.processImage(file);
        const uploadRes = await fetch("/api/upload-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            imageData: { full, thumbnail },
            messageId,
          }),
        });
        if (!uploadRes.ok) throw new Error("Failed to upload image");
        const newMessage: Message = {
          id: messageId,
          text: "📷 Image",
          username: currentUsername,
          timestamp: Date.now(),
          userId,
          status: "sending",
          reactions: [],
          type: "image",
          imageId: messageId,
          imageUrl: full,
          imageThumbnail: thumbnail,
        };
        setMessages((prev) => {
          if (prev.some((m) => m.id === messageId)) return prev;
          return [...prev, newMessage].sort(
            (a, b) => a.timestamp - b.timestamp
          );
        });
        setTimeout(
          () =>
            messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }),
          100
        );
        const updateStatus = (status: MessageStatus | undefined) =>
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === messageId ? { ...msg, status } : msg
            )
          );
        try {
          updateStatus("sent");
          const messageToSend = { ...newMessage };
          delete (messageToSend as any).imageUrl;
          delete (messageToSend as any).imageThumbnail;
          const res = await apiService.sendMessage(messageToSend);
          if (res.ok) {
            updateStatus("delivered");
            setTimeout(
              () => updateStatus(undefined),
              CONFIG.STATUS_CLEAR_DELAY
            );
          } else {
            updateStatus("error");
          }
        } catch (err) {
          console.error("Error sending image message:", err);
          updateStatus("error");
        }
      } catch (err) {
        console.error("Error processing image:", err);
        alert("Failed to process image. Please try again.");
      } finally {
        setIsUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [usernameRef, userId, updateLastActive, setMessages, messagesEndRef]
  );

  const handleImageButtonClick = () => fileInputRef.current?.click();
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleImageUpload(file);
  };

  return {
    isUploading,
    fileInputRef,
    handleImageButtonClick,
    handleFileSelect,
    handleImageUpload,
  };
};

const useReactions = (
  messages: Message[],
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>,
  userId: string,
  username: string
) => {
  const addReaction = useCallback(
    async (messageId: string, reactionType: ReactionType) => {
      const message = messages.find((m) => m.id === messageId);
      const cleanReactions = utils.sanitizeReactions(
        message?.reactions || []
      );
      const hasReacted = cleanReactions.some(
        (r) => r.userId === userId && r.type === reactionType
      );
      const updatedReactions = hasReacted
        ? cleanReactions.filter(
            (r) => !(r.userId === userId && r.type === reactionType)
          )
        : [
            ...cleanReactions,
            {
              type: reactionType,
              userId,
              username,
              timestamp: Date.now(),
            },
          ];
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === messageId
            ? { ...msg, reactions: updatedReactions }
            : msg
        )
      );
      try {
        await apiService.putReactions(messageId, updatedReactions);
        await apiService.sendReaction(
          messageId,
          hasReacted
            ? null
            : updatedReactions[updatedReactions.length - 1]
        );
      } catch (err) {
        console.error("Error updating reaction:", err);
      }
    },
    [messages, setMessages, userId, username]
  );
  return { addReaction };
};

const usePageVisibility = () => {
  const [isVisible, setIsVisible] = useState(true);
  const isVisibleRef = useRef(true);

  useEffect(() => {
    const handleVisibilityChange = () => {
      const visible = !document.hidden;
      setIsVisible(visible);
      isVisibleRef.current = visible;
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  return { isVisible, isVisibleRef };
};

const useDocumentTitle = (newMessageCount: number, isJoined: boolean) => {
  useEffect(() => {
    if (!isJoined) {
      document.title = "Chatto - Real-time Chat";
      return;
    }
    
    if (newMessageCount > 0) {
      document.title = `(${newMessageCount}) New Message${newMessageCount !== 1 ? 's' : ''}`;
    } else {
      document.title = "Chatto - Real-time Chat";
    }
    
    return () => {
      document.title = "Chatto - Real-time Chat";
    };
  }, [newMessageCount, isJoined]);
};

const usePusher = (
  isJoined: boolean,
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>,
  setNewMessageCount: React.Dispatch<React.SetStateAction<number>>,
  setFirstUnreadId: React.Dispatch<React.SetStateAction<string | null>>,
  messagesEndRef: React.RefObject<HTMLDivElement | null>,
  messagesContainerRef: React.RefObject<HTMLDivElement | null>,
  currentUserId: string,
  isVisibleRef: React.RefObject<boolean>,
  isUserScrolledRef: React.RefObject<boolean>,
  isLoadingRef: React.RefObject<boolean>,
  currentUsernameRef: React.RefObject<string>
) => {
  const lastMentionTimeRef = useRef<number>(0);

  useEffect(() => {
    if (!isJoined) return;

    const pusher = new Pusher(CONFIG.PUSHER_KEY, {
      cluster: CONFIG.PUSHER_CLUSTER,
      authEndpoint: "/api/pusher-auth",
    });
    const channel = pusher.subscribe("private-chat-channel");

    channel.bind("new-message", async (data: any) => {
      if (isLoadingRef.current) return;

      let imageUrl: string | undefined;
      let imageThumbnail: string | undefined;
      if (data.type === "image" && data.imageId) {
        const imageData = await apiService.fetchImage(data.imageId);
        if (imageData) {
          imageUrl = imageData.full;
          imageThumbnail = imageData.thumbnail;
        }
      }

      const currentUsername = currentUsernameRef.current;
      const isMentioned = utils.isUserMentioned(
        data as Message,
        currentUserId,
        currentUsername
      );
      if (isMentioned) {
        const now = Date.now();
        if (now - lastMentionTimeRef.current >= 1000) {
          lastMentionTimeRef.current = now;
          soundManager.playMentionSound();
        }
      }

      const isOwnMessage = data.userId === currentUserId;
      const pageVisible = isVisibleRef.current;
      const userScrolled = isUserScrolledRef.current;
      const shouldAutoScroll = isOwnMessage || (pageVisible && !userScrolled);

      setMessages((prev) => {
        if (prev.some((m) => m.id === data.id)) return prev;
        const newMessage: Message = {
          ...data,
          status: "delivered" as MessageStatus,
          imageUrl,
          imageThumbnail,
        };
        const updated = [...prev, newMessage].sort(
          (a, b) => a.timestamp - b.timestamp
        );
        setTimeout(() => utils.saveMessagesToCache(updated), 0);
        return updated;
      });

      if (shouldAutoScroll) {
        setTimeout(() => {
          messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
        }, 100);
      } else {
        setFirstUnreadId((prev) => (prev === null ? data.id : prev));
        setNewMessageCount((c) => c + 1);
      }
    });

    channel.bind(
      "message-reaction",
      (data: { messageId: string; reaction: Reaction | null }) => {
        if (!data.reaction) return;
        setMessages((prev) =>
          prev.map((msg) => {
            if (msg.id !== data.messageId) return msg;
            const alreadyExists = msg.reactions?.some(
              (r) =>
                r?.userId === data.reaction!.userId &&
                r?.type === data.reaction!.type
            );
            if (alreadyExists) return msg;
            const updated = {
              ...msg,
              reactions: [
                ...utils.sanitizeReactions(msg.reactions),
                data.reaction!,
              ],
            };
            setTimeout(() => utils.saveMessagesToCache(prev.map(m => 
              m.id === data.messageId ? updated : m
            )), 0);
            return updated;
          })
        );
      }
    );

    return () => {
      channel.unbind_all();
      channel.unsubscribe();
      pusher.disconnect();
    };
  }, [
    isJoined,
    currentUserId,
    setMessages,
    setNewMessageCount,
    setFirstUnreadId,
    messagesEndRef,
    messagesContainerRef,
    isVisibleRef,
    isUserScrolledRef,
    isLoadingRef,
    currentUsernameRef,
  ]);
};

const useActivityTracking = (
  isJoined: boolean,
  updateLastActive: () => Promise<void>
) => {
  const activityTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const updateUserActivity = useCallback(() => {
    if (!isJoined) return;
    if (activityTimeoutRef.current) clearTimeout(activityTimeoutRef.current);
    updateLastActive();
    activityTimeoutRef.current = setTimeout(() => {}, 120000);
  }, [isJoined, updateLastActive]);

  useEffect(() => {
    if (!isJoined) return;
    const events = [
      "mousedown",
      "keydown",
      "scroll",
      "touchstart",
      "click",
      "focus",
    ];
    const handleUserActivity = () => updateUserActivity();
    events.forEach((event) =>
      window.addEventListener(event, handleUserActivity)
    );
    updateUserActivity();
    return () => {
      events.forEach((event) =>
        window.removeEventListener(event, handleUserActivity)
      );
      if (activityTimeoutRef.current) clearTimeout(activityTimeoutRef.current);
    };
  }, [isJoined, updateUserActivity]);

  return { updateUserActivity };
};

const useMentionSuggestions = (
  onlineUsers: User[],
  currentUserId: string,
  setInputMessage: React.Dispatch<React.SetStateAction<string>>
) => {
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestions, setSuggestions] = useState<User[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const updateSuggestions = useCallback(
    (text: string, cursorPos: number) => {
      const textBeforeCursor = text.substring(0, cursorPos);
      const lastAtIndex = textBeforeCursor.lastIndexOf("@");
      if (lastAtIndex !== -1) {
        const query = textBeforeCursor.substring(lastAtIndex + 1);
        const hasSpace = query.includes(" ");
        const isMention = !hasSpace && !query.includes("@");
        if (isMention) {
          const filteredUsers = onlineUsers
            .filter((u) => u.id !== currentUserId)
            .filter((u) =>
              u.username.toLowerCase().includes(query.toLowerCase())
            )
            .slice(0, 5);
          const everyoneOption: User = {
            id: "everyone",
            username: "everyone",
            joinedAt: 0,
            lastActive: 0,
          };
          const suggestionsList = [
            "everyone".toLowerCase().includes(query.toLowerCase())
              ? everyoneOption
              : null,
            ...filteredUsers,
          ].filter(Boolean) as User[];
          setSuggestions(suggestionsList);
          setShowSuggestions(suggestionsList.length > 0);
          setSelectedIndex(0);
          return;
        }
      }
      setShowSuggestions(false);
      setSuggestions([]);
    },
    [onlineUsers, currentUserId]
  );

  const insertMention = useCallback(
    (username: string) => {
      if (!inputRef.current) return;
      const text = inputRef.current.value;
      const cursorPos = inputRef.current.selectionStart || 0;
      const textBeforeCursor = text.substring(0, cursorPos);
      const lastAtIndex = textBeforeCursor.lastIndexOf("@");
      if (lastAtIndex !== -1) {
        const newText =
          text.substring(0, lastAtIndex) +
          `@${username} ` +
          text.substring(cursorPos);
        inputRef.current.value = newText;
        setInputMessage(newText);
        inputRef.current.focus();
        const newCursorPos = lastAtIndex + username.length + 2;
        inputRef.current.setSelectionRange(newCursorPos, newCursorPos);
      }
      setShowSuggestions(false);
      setSuggestions([]);
    },
    [setInputMessage]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (!showSuggestions) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % suggestions.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex(
          (prev) => (prev - 1 + suggestions.length) % suggestions.length
        );
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        if (suggestions[selectedIndex])
          insertMention(suggestions[selectedIndex].username);
      } else if (e.key === "Escape") {
        setShowSuggestions(false);
      }
    },
    [showSuggestions, suggestions, selectedIndex, insertMention]
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setInputMessage(value);
      const cursorPos = e.target.selectionStart || 0;
      updateSuggestions(value, cursorPos);
    },
    [setInputMessage, updateSuggestions]
  );

  return {
    showSuggestions,
    suggestions,
    selectedIndex,
    inputRef,
    handleKeyDown,
    handleInputChange,
    insertMention,
  };
};

// ============================================================
// CHAT SCREEN COMPONENT
// ============================================================

const ChatScreen = ({
  messages,
  username,
  onlineUsers,
  hoveredMessageId,
  setHoveredMessageId,
  isMobileMenuOpen,
  setIsMobileMenuOpen,
  showScrollButton,
  newMessageCount,
  showLoadMoreButton,
  hasMoreMessages,
  isLoading,
  isLoadingMore,
  isUploading,
  userId,
  firstUnreadId,
  messagesEndRef,
  messagesContainerRef,
  fileInputRef,
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
  showSuggestions,
  suggestions,
  selectedIndex,
  inputRef,
  handleKeyDown,
  handleInputChange,
  insertMention,
  isLoadingNewMessages,
  showCachedOnly,
}: any) => (
  <div className="h-screen flex flex-col bg-gradient-to-br from-gray-50 via-blue-50 to-indigo-100 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 overflow-hidden transition-colors duration-300">
    <div className="bg-white dark:bg-gray-800 shadow-lg border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
      <div className="px-4 sm:px-6 py-3 flex justify-between items-center w-full lg:max-w-[90%] xl:max-w-[80%] mx-auto">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="lg:hidden p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl"
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
            <p className="text-xs text-gray-500 dark:text-gray-400 hidden sm:block">Gawa ni Jirik</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <button onClick={toggleTheme} className="p-2 rounded-full bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600">
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
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              <span className="text-sm text-gray-600 dark:text-gray-300">{username}</span>
            </div>
            <button onClick={onClearSavedUser} className="text-sm text-red-500 hover:text-red-600 font-medium">Leave</button>
          </div>
        </div>
      </div>
    </div>

    <div className="flex-1 flex items-center justify-center p-4 overflow-hidden">
      <div className="w-full lg:max-w-[90%] xl:max-w-[80%] h-full flex gap-4">
        <div className={`lg:flex lg:w-72 bg-white dark:bg-gray-800 rounded-2xl shadow-xl flex-shrink-0 flex flex-col overflow-hidden ${
          isMobileMenuOpen ? "fixed inset-y-0 left-0 z-50 w-72" : "hidden lg:flex"
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
                <p className="text-sm">No active users</p>
              </div>
            ) : (
              onlineUsers.map((user: User) => (
                <UserListItem key={user.id} user={user} isCurrentUser={user.id === userId} />
              ))
            )}
          </div>
        </div>

        {isMobileMenuOpen && (
          <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setIsMobileMenuOpen(false)} />
        )}

        <div className="flex-1 bg-white dark:bg-gray-800 rounded-2xl shadow-xl flex flex-col overflow-hidden relative">
          {showLoadMoreButton && hasMoreMessages && !isLoading && messages.length > 0 && (
            <div className="sticky top-0 z-10 p-3 flex justify-center bg-white/95 dark:bg-gray-800/95 border-b flex-shrink-0">
              <button onClick={onLoadMoreMessages} disabled={isLoadingMore} className="bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 px-4 py-2 rounded-xl text-sm flex items-center gap-2 shadow-md">
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
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                    </svg>
                    <span>Load older messages</span>
                  </>
                )}
              </button>
            </div>
          )}

          {(showScrollButton || newMessageCount > 0) && (
            <button onClick={onScrollToBottom} className="absolute bottom-20 right-4 bg-blue-500 text-white rounded-full px-3 py-2 shadow-lg hover:bg-blue-600 z-10 text-sm flex items-center gap-2 transition-all">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
              </svg>
              {newMessageCount > 0 && <span>{newMessageCount} new</span>}
            </button>
          )}

          <div ref={messagesContainerRef} onScroll={onScroll} className="flex-1 overflow-y-auto p-4">
            {isLoading && messages.length === 0 ? (
              <div className="flex justify-center items-center h-full">
                <div className="text-center">
                  <svg className="animate-spin h-8 w-8 text-blue-500 mx-auto mb-3" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  <p className="text-gray-500 dark:text-gray-400">Loading messages...</p>
                </div>
              </div>
            ) : messages.length === 0 ? (
              <div className="flex justify-center items-center h-full">
                <div className="text-center">
                  <svg className="h-16 w-16 text-gray-300 dark:text-gray-600 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                  <p className="text-gray-500 dark:text-gray-400 text-lg">No messages yet</p>
                  <p className="text-gray-400 dark:text-gray-500 text-sm">Start the conversation!</p>
                </div>
              </div>
            ) : (
              <div>
                {/* Show messages - all messages are displayed together */}
                {messages.map((message: Message) => (
                  <MessageBubble
                    key={message.id}
                    message={message}
                    currentUserId={userId}
                    currentUsername={username}
                    isHovered={hoveredMessageId === message.id}
                    onMouseEnter={() => setHoveredMessageId(message.id)}
                    onMouseLeave={() => setTimeout(() => setHoveredMessageId(null), 200)}
                    onReact={(type: ReactionType) => onAddReaction(message.id, type)}
                    onlineUsers={onlineUsers}
                    isNew={false}
                  />
                ))}
                
                {/* Show loading animation between cached and new messages */}
                {isLoadingNewMessages && (
                  <LoadingNewMessages />
                )}
              </div>
            )}
            
            <div ref={messagesEndRef} />
          </div>

          <div className="border-t border-gray-200 dark:border-gray-700 p-4 bg-white dark:bg-gray-800 relative">
            {showSuggestions && suggestions.length > 0 && (
              <div className="absolute bottom-full left-0 right-0 mb-2 z-20 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                {suggestions.map((user: User, idx: number) => (
                  <button
                    key={user.id}
                    onClick={() => insertMention(user.username)}
                    className={`w-full text-left px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 transition-colors ${
                      idx === selectedIndex ? "bg-gray-100 dark:bg-gray-700" : ""
                    }`}
                  >
                    <div className="w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center text-white text-xs font-semibold">
                      {user.username.charAt(0).toUpperCase()}
                    </div>
                    <span className="text-sm text-gray-700 dark:text-gray-300">@{user.username}</span>
                    {user.username === "everyone" && (
                      <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">(Notify all)</span>
                    )}
                  </button>
                ))}
              </div>
            )}
            <form onSubmit={onSendMessage} className="space-y-2">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onImageUpload}
                  disabled={isUploading}
                  className="bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 px-3 py-2 rounded-xl flex-shrink-0 disabled:opacity-50"
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
                <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/gif,image/webp" onChange={onFileSelect} className="hidden" />
                <div className="relative flex-1">
                  <input
                    ref={inputRef}
                    type="text"
                    onChange={handleInputChange}
                    onKeyDown={handleKeyDown}
                    onFocus={updateUserActivity}
                    onClick={updateUserActivity}
                    onPaste={onPaste}
                    placeholder="Type a message... Use @ to mention someone"
                    className="w-full px-4 py-2 border-2 border-gray-200 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    maxLength={500}
                  />
                </div>
                <button type="submit" className="bg-blue-500 text-white px-5 py-2 rounded-xl hover:bg-blue-600 font-medium text-sm shadow-md">
                  Send
                </button>
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 px-1">
                💡 Tip: Type <span className="font-mono bg-gray-100 dark:bg-gray-700 px-1 rounded">@</span> to mention someone
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>

    <style jsx global>{`
      @keyframes slideInFromBottom {
        0% {
          transform: translateY(30px);
          opacity: 0;
        }
        100% {
          transform: translateY(0);
          opacity: 1;
        }
      }
      
      .animate-slideInFromBottom {
        animation: slideInFromBottom 0.5s cubic-bezier(0.68, -0.55, 0.265, 1.55) forwards;
      }
    `}</style>
  </div>
);

// ============================================================
// MAIN COMPONENT
// ============================================================
export default function Home() {
  const { theme, toggleTheme } = useTheme();
  const [username, setUsername] = useState("");
  const [isJoined, setIsJoined] = useState(false);
  const [isUserScrolled, setIsUserScrolled] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [hoveredMessageId, setHoveredMessageId] = useState<string | null>(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [inputMessage, setInputMessage] = useState("");

  const persistentUserId = useRef<string>(getOrCreateUserId());
  const isUserScrolledRef = useRef(false);
  const isLoadingRef = useRef(true);

  const { isVisible, isVisibleRef } = usePageVisibility();

  const {
    messages,
    setMessages,
    isLoading,
    isLoadingMore,
    hasMoreMessages,
    showLoadMoreButton,
    setShowLoadMoreButton,
    newMessageCount,
    setNewMessageCount,
    firstUnreadId,
    setFirstUnreadId,
    messagesEndRef,
    messagesContainerRef,
    loadMessages,
    loadMoreMessages,
    isLoadingNewMessages,
    showCachedOnly,
  } = useMessages();

  useDocumentTitle(newMessageCount, isJoined);

  useEffect(() => {
    isLoadingRef.current = isLoading;
  }, [isLoading]);

  const { onlineUsers, userId, usernameRef, updateLastActive } =
    useUserPresence(isJoined, persistentUserId.current);

  const { updateUserActivity } = useActivityTracking(isJoined, updateLastActive);

  const {
    isUploading,
    fileInputRef,
    handleImageButtonClick,
    handleFileSelect,
    handleImageUpload,
  } = useImageUpload(usernameRef, userId, updateLastActive, setMessages, messagesEndRef);

  const { addReaction } = useReactions(messages, setMessages, userId, usernameRef.current);

  const {
    showSuggestions,
    suggestions,
    selectedIndex,
    inputRef,
    handleKeyDown,
    handleInputChange,
    insertMention,
  } = useMentionSuggestions(onlineUsers, userId, setInputMessage);

  usePusher(
    isJoined,
    setMessages,
    setNewMessageCount,
    setFirstUnreadId,
    messagesEndRef,
    messagesContainerRef,
    userId,
    isVisibleRef,
    isUserScrolledRef,
    isLoadingRef,
    usernameRef
  );

  const handleScroll = useCallback(() => {
    if (!messagesContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = messagesContainerRef.current;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 100;
    const isNearTop = scrollTop < 50;

    isUserScrolledRef.current = !isNearBottom;
    setIsUserScrolled(!isNearBottom);
    setShowScrollButton(!isNearBottom && scrollHeight > clientHeight);

    if (isNearBottom && newMessageCount > 0) {
      setNewMessageCount(0);
      setFirstUnreadId(null);
    }

    if (isNearTop && hasMoreMessages && !isLoadingMore && messages.length > 0) {
      setShowLoadMoreButton(true);
    } else if (!isNearTop) {
      setShowLoadMoreButton(false);
    }

    updateUserActivity();
  }, [
    messagesContainerRef,
    newMessageCount,
    hasMoreMessages,
    isLoadingMore,
    messages.length,
    setNewMessageCount,
    setFirstUnreadId,
    setShowLoadMoreButton,
    updateUserActivity,
  ]);

  const sendMessage = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const messageText = inputMessage.trim();
      if (!messageText) return;
      const currentUsername = usernameRef.current;
      if (!currentUsername) return;

      setInputMessage("");
      if (inputRef.current) inputRef.current.value = "";

      updateUserActivity();
      updateLastActive();

      const messageId = utils.generateId();
      const { mentions } = utils.parseMentions(messageText, onlineUsers, userId);
      const newMessage: Message = {
        id: messageId,
        text: messageText,
        username: currentUsername,
        timestamp: Date.now(),
        userId,
        status: "sending",
        reactions: [],
        type: "text",
        mentions,
      };

      setMessages((prev) => {
        if (prev.some((m) => m.id === messageId)) return prev;
        const updated = [...prev, newMessage].sort((a, b) => a.timestamp - b.timestamp);
        setTimeout(() => utils.saveMessagesToCache(updated), 0);
        return updated;
      });

      isUserScrolledRef.current = false;
      setIsUserScrolled(false);
      setShowScrollButton(false);
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 50);

      const updateStatus = (status: MessageStatus | undefined) =>
        setMessages((prev) =>
          prev.map((msg) => (msg.id === messageId ? { ...msg, status } : msg))
        );

      apiService
        .sendMessage(newMessage)
        .then((res) => {
          if (res.ok) {
            updateStatus("delivered");
            setTimeout(() => updateStatus(undefined), CONFIG.STATUS_CLEAR_DELAY);
          } else {
            updateStatus("error");
          }
        })
        .catch((err) => {
          console.error("Error sending message:", err);
          updateStatus("error");
        });
    },
    [inputMessage, usernameRef, updateUserActivity, updateLastActive, userId, setMessages, setInputMessage, setIsUserScrolled, setShowScrollButton, messagesEndRef, onlineUsers, inputRef]
  );

  const handlePaste = useCallback(
    async (e: React.ClipboardEvent) => {
      const items = e.clipboardData.items;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.indexOf("image") !== -1) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) await handleImageUpload(file);
          break;
        }
      }
    },
    [handleImageUpload]
  );

  const scrollToBottom = useCallback(() => {
    setNewMessageCount(0);
    setFirstUnreadId(null);
    isUserScrolledRef.current = false;
    setIsUserScrolled(false);
    setShowScrollButton(false);
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    updateUserActivity();
  }, [setNewMessageCount, setFirstUnreadId, setIsUserScrolled, setShowScrollButton, messagesEndRef, updateUserActivity]);

  const joinChat = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!username.trim()) return;
      usernameRef.current = username;
      localStorage.setItem("chat-username", username);
      setIsJoined(true);
    },
    [username, usernameRef]
  );

  const clearSavedUser = useCallback(() => {
    localStorage.removeItem("chat-username");
    localStorage.removeItem("chat-userId");
    localStorage.removeItem(CONFIG.MESSAGES_CACHE_KEY);
    localStorage.removeItem(CONFIG.MESSAGES_CACHE_TIMESTAMP_KEY);
    setUsername("");
    usernameRef.current = "";
    window.location.reload();
  }, [usernameRef]);

  const handleUsernameChange = useCallback((value: string) => {
    setUsername(value);
    usernameRef.current = value;
  }, [usernameRef]);

  useEffect(() => {
    const savedUsername = localStorage.getItem("chat-username");
    if (savedUsername) {
      setUsername(savedUsername);
      usernameRef.current = savedUsername;
      setIsJoined(true);
    }
  }, [usernameRef]);

  useEffect(() => {
    if (isJoined) loadMessages();
  }, [isJoined, loadMessages]);

  useEffect(() => {
    if (isVisible && !isUserScrolled && newMessageCount > 0) {
      setNewMessageCount(0);
      setFirstUnreadId(null);
    }
  }, [isVisible, isUserScrolled, newMessageCount, setNewMessageCount, setFirstUnreadId]);

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
      userId={userId}
      firstUnreadId={firstUnreadId}
      messagesEndRef={messagesEndRef}
      messagesContainerRef={messagesContainerRef}
      fileInputRef={fileInputRef}
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
      showSuggestions={showSuggestions}
      suggestions={suggestions}
      selectedIndex={selectedIndex}
      inputRef={inputRef}
      handleKeyDown={handleKeyDown}
      handleInputChange={handleInputChange}
      insertMention={insertMention}
      isLoadingNewMessages={isLoadingNewMessages}
      showCachedOnly={showCachedOnly}
    />
  );
}
