"use client";
import Image from "next/image";
import { useState, useEffect, useRef, useCallback } from "react";
import Pusher from "pusher-js";

// ============================================================
// TYPES & INTERFACES
// ============================================================
type MessageStatus = "sending" | "sent" | "delivered" | "error";
type ReactionType = "👍" | "❤️" | "😂" | "😮" | "😢" | "🙏";

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
}

interface User {
  id: string;
  username: string;
  joinedAt: number;
  lastActive: number;
}

interface FirebaseMessage {
  text: string;
  username: string;
  timestamp: number;
  userId: string;
  createdAt: string;
  reactions?: Reaction[];
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

// ============================================================
// API HELPERS
// ============================================================
const api = {
  getMessagesCount: async () => {
    try {
      const res = await fetch(`${FIREBASE_DB_URL}/messages.json?shallow=true`);
      const data = await res.json();
      return Object.keys(data || {}).length;
    } catch (err) {
      console.error("Error getting message count:", err);
      return 0;
    }
  },
  getMessages: (limit?: number) => {
    let url = `${FIREBASE_DB_URL}/messages.json?orderBy="$key"`;
    if (limit) url += `&limitToLast=${limit}`;
    return fetch(url);
  },
  getMessagesBefore: (endBefore: string, limit: number) => {
    return fetch(`${FIREBASE_DB_URL}/messages.json?orderBy="$key"&endBefore="${endBefore}"&limitToLast=${limit}`);
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
// SUB-COMPONENTS
// ============================================================
function StatusIcon({ status }: { status: MessageStatus }) {
  const configs = {
    sending: {
      color: "text-gray-500",
      label: "Sending...",
      icon: (
        <svg className="animate-spin h-2 w-2 sm:h-3 sm:w-3" viewBox="0 0 24 24">
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
    <div className="bg-white rounded-lg shadow-lg border p-0.5 sm:p-1 flex gap-0 z-20">
      {REACTIONS.map((reaction) => {
        const isActive = sanitizeReactions(reactions || []).some(
          (r) => r.userId === userId && r.type === reaction
        );
        return (
          <button
            key={reaction}
            onClick={() => onReact(reaction)}
            className={`hover:bg-gray-100 p-0.5 sm:p-1 rounded transition-colors text-xs sm:text-base ${
              isActive ? "bg-blue-100" : ""
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
            className={`inline-flex items-center gap-0.5 bg-white border rounded-full px-[2px] py-[1px] sm:px-1 sm:py-0.5 text-[8px] sm:text-xs shadow-md ${
              isActive ? "border-blue-500 bg-blue-50" : "border-gray-300 bg-white"
            }`}
          >
            <span className="text-[10px] sm:text-sm">{reaction.type}</span>
            <span className="text-[8px] sm:text-xs text-gray-600">{counts[reaction.type]}</span>
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
  
  return (
    <div className={`flex ${isOwn ? "justify-end" : "justify-start"} ${hasReactions ? 'mb-6 sm:mb-7' : 'mb-2 sm:mb-3'}`}>
      <div
        className="relative max-w-[85%] sm:max-w-[70%] md:max-w-[60%] min-w-[40px]"
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        {/* Reaction Picker - Shows on hover at the top of bubble */}
        {isHovered && (
          <div className={`absolute -top-6 sm:-top-8 ${isOwn ? "right-0" : "left-0"} z-10`}>
            <ReactionPicker
              reactions={message.reactions}
              userId={currentUserId}
              onReact={onReact}
            />
          </div>
        )}
        {/* Bubble with word wrapping and overflow handling */}
        <div
          className={`rounded-lg p-1.5 sm:p-2.5 ${
            isOwn ? "bg-blue-500 text-white" : "bg-gray-100 text-gray-800"
          } overflow-hidden`}
        >
          <div className="flex items-center gap-1 sm:gap-2 mb-0.5">
            <span className="font-semibold text-[11px] sm:text-sm truncate max-w-[120px] sm:max-w-[200px]">
              {message.username}
            </span>
            <span className="text-[8px] sm:text-xs opacity-75 flex-shrink-0">
              {formatTime(message.timestamp)}
            </span>
          </div>
          <p className="break-words whitespace-pre-wrap text-[11px] sm:text-sm overflow-hidden">
            {message.text}
          </p>
          {isOwn && message.status && (
            <div className="mt-0.5 flex justify-end">
              <StatusIcon status={message.status} />
            </div>
          )}
        </div>
        {/* Reactions Display - Positioned below bubble */}
        {hasReactions && (
          <div className={`absolute -bottom-3 ${isOwn ? "right-0" : "left-0"} z-5`}>
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
      className={`flex items-center gap-2 sm:gap-3 p-2 sm:p-2.5 hover:bg-gray-50 transition-colors border-b ${
        isCurrentUser ? "bg-blue-50" : ""
      }`}
    >
      <div className="relative flex-shrink-0">
        <div
          className={`w-6 h-6 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-white text-[8px] sm:text-xs font-semibold ${
            isCurrentUser
              ? "bg-gradient-to-br from-green-400 to-green-600"
              : "bg-gradient-to-br from-blue-400 to-indigo-500"
          }`}
        >
          {user.username?.charAt(0).toUpperCase()}
        </div>
        <div className="absolute bottom-0 right-0 w-1.5 h-1.5 sm:w-2 sm:h-2 bg-green-500 rounded-full border border-white" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs sm:text-sm font-medium text-gray-800 truncate">
          {user.username}
          {isCurrentUser && (
            <span className="ml-1 sm:ml-2 text-[8px] sm:text-xs text-green-600">(You)</span>
          )}
        </p>
        <p className="text-[8px] sm:text-xs text-gray-500">Active now</p>
      </div>
    </div>
  );
}

// ============================================================
// MAIN COMPONENT
// ============================================================
export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState("");
  const [username, setUsername] = useState("");
  const [isJoined, setIsJoined] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(true);
  const [showLoadMoreButton, setShowLoadMoreButton] = useState(false);
  const [totalMessages, setTotalMessages] = useState(0);
  const [onlineUsers, setOnlineUsers] = useState<User[]>([]);
  const [hoveredMessageId, setHoveredMessageId] = useState<string | null>(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isUserScrolled, setIsUserScrolled] = useState(false);
  const [newMessageCount, setNewMessageCount] = useState(0);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const userIdRef = useRef<string>(generateId());
  const userHeartbeatRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const activityTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);

  // ── User Presence Functions (Declared first) ─────────────────────────
  const updateLastActive = useCallback(async () => {
    if (!isJoined) return;
    try {
      await api.patchUser(userIdRef.current, { lastActive: Date.now() });
    } catch (err) {
      console.error("Error updating last active:", err);
    }
  }, [isJoined]);

  const loadOnlineUsers = useCallback(async () => {
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
  }, []);

  // ── Track user activity ──────────────────────────────────
  const updateUserActivity = useCallback(() => {
    if (!isJoined) return;
    
    if (activityTimeoutRef.current) {
      clearTimeout(activityTimeoutRef.current);
    }
    
    updateLastActive();
    
    activityTimeoutRef.current = setTimeout(() => {}, 120000);
  }, [isJoined, updateLastActive]);

  // ── Track user events for activity ───────────────────────
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
  }, [isJoined, updateUserActivity]);

  // ── Persistence ──────────────────────────────────────────
  useEffect(() => {
    const savedUsername = localStorage.getItem("chat-username");
    const savedUserId = localStorage.getItem("chat-userId");
    if (savedUsername && savedUserId) {
      setUsername(savedUsername);
      userIdRef.current = savedUserId;
      setIsJoined(true);
    }
  }, []);

  // ── Scroll Detection ─────────────────────────────────────
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

  // ── Load More Messages ───────────────────────────────────
  const loadMoreMessages = async () => {
    if (isLoadingMore || !hasMoreMessages || messages.length === 0) return;
    
    setIsLoadingMore(true);
    try {
      const oldestMessage = messages[0];
      if (!oldestMessage) return;
      
      const res = await api.getMessagesBefore(oldestMessage.id, MESSAGES_PER_PAGE);
      const data: Record<string, FirebaseMessage> = await res.json();
      
      const olderMessages: Message[] = Object.entries(data || {})
        .filter(([, msg]) => msg?.text && msg?.username)
        .map(([key, msg]) => ({
          id: key,
          text: msg.text,
          username: msg.username,
          timestamp: msg.timestamp || Date.now(),
          userId: msg.userId || "",
          status: "delivered" as MessageStatus,
          reactions: sanitizeReactions(msg.reactions || []),
        }))
        .sort((a, b) => a.timestamp - b.timestamp);
      
      if (olderMessages.length === 0 || olderMessages.length < MESSAGES_PER_PAGE) {
        setHasMoreMessages(false);
      } else {
        const newTotalCount = messages.length + olderMessages.length;
        if (newTotalCount >= totalMessages) {
          setHasMoreMessages(false);
        }
      }
      
      if (olderMessages.length > 0) {
        const scrollHeightBefore = messagesContainerRef.current?.scrollHeight || 0;
        const scrollTopBefore = messagesContainerRef.current?.scrollTop || 0;
        
        setMessages(prev => [...olderMessages, ...prev]);
        
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

  // ── Check if there are older messages ────────────────────
  const checkForOlderMessages = useCallback(async () => {
    if (messages.length === 0) return;
    
    try {
      const oldestMessageId = messages[0].id;
      const res = await fetch(`${FIREBASE_DB_URL}/messages.json?orderBy="$key"&endBefore="${oldestMessageId}"&limitToLast=1`);
      const data = await res.json();
      
      setHasMoreMessages(Object.keys(data || {}).length > 0);
    } catch (err) {
      console.error("Error checking for older messages:", err);
    }
  }, [messages]);

  // ── Load Initial Messages ────────────────────────────────
  const loadMessages = useCallback(async () => {
    setIsLoading(true);
    try {
      const totalCount = await api.getMessagesCount();
      setTotalMessages(totalCount);
      
      const res = await api.getMessages(MESSAGES_PER_PAGE);
      const data: Record<string, FirebaseMessage> = await res.json();
      
      const loaded: Message[] = Object.entries(data || {})
        .filter(([, msg]) => msg?.text && msg?.username)
        .map(([key, msg]) => ({
          id: key,
          text: msg.text,
          username: msg.username,
          timestamp: msg.timestamp || Date.now(),
          userId: msg.userId || "",
          status: "delivered" as MessageStatus,
          reactions: sanitizeReactions(msg.reactions || []),
        }))
        .sort((a, b) => a.timestamp - b.timestamp);
      
      setMessages(loaded);
      
      if (loaded.length > 0) {
        const oldestMessageId = loaded[0].id;
        const olderCheck = await fetch(`${FIREBASE_DB_URL}/messages.json?orderBy="$key"&endBefore="${oldestMessageId}"&limitToLast=1`);
        const olderData = await olderCheck.json();
        setHasMoreMessages(Object.keys(olderData || {}).length > 0);
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
  }, []);

  // ── User Presence ─────────────────────────────────────────
  const registerUser = useCallback(async () => {
    try {
      await api.putUser(userIdRef.current, {
        username,
        joinedAt: Date.now(),
        lastActive: Date.now(),
      });
      setTimeout(loadOnlineUsers, 1000);
    } catch (err) {
      console.error("Error registering user:", err);
    }
  }, [username, loadOnlineUsers]);

  const removeUser = useCallback(async () => {
    try {
      await api.deleteUser(userIdRef.current);
    } catch (err) {
      console.error("Error removing user:", err);
    }
  }, []);

  // ── Effects ───────────────────────────────────────────────
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
  }, [isJoined, registerUser, loadMessages, loadOnlineUsers, updateLastActive, removeUser]);

  useEffect(() => {
    if (!isJoined) return;
    const interval = setInterval(loadOnlineUsers, USER_REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [isJoined, loadOnlineUsers]);

  useEffect(() => {
    if (!isJoined || messages.length === 0) return;
    checkForOlderMessages();
  }, [isJoined, messages, checkForOlderMessages]);

  useEffect(() => {
    if (!isUserScrolled && messagesEndRef.current && messages.length > 0 && !isLoadingMore) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isUserScrolled, isLoadingMore]);

  useEffect(() => {
    if (!isJoined) return;
    
    const handleInputFocus = () => {
      updateLastActive();
      updateUserActivity();
    };
    
    const inputElement = document.querySelector('input[type="text"]');
    if (inputElement) {
      inputElement.addEventListener('focus', handleInputFocus);
      inputElement.addEventListener('click', handleInputFocus);
    }
    
    return () => {
      if (inputElement) {
        inputElement.removeEventListener('focus', handleInputFocus);
        inputElement.removeEventListener('click', handleInputFocus);
      }
    };
  }, [isJoined, updateLastActive, updateUserActivity]);

  // ── Pusher ────────────────────────────────────────────────
  useEffect(() => {
    if (!isJoined) return;
    const pusher = new Pusher("bc4bbe143420c20c0e9d", {
      cluster: "ap1",
      authEndpoint: "/api/pusher-auth",
    });
    const channel = pusher.subscribe("private-chat-channel");
    channel.bind("new-message", (data: Message) => {
      setMessages((prev) => {
        if (prev.some((m) => m.id === data.id)) return prev;
        const newMessages = [...prev, { ...data, status: "delivered" as MessageStatus }].sort(
          (a, b) => a.timestamp - b.timestamp
        );
        
        if (isUserScrolled) {
          setNewMessageCount(prev => prev + 1);
        }
        
        return newMessages;
      });
    });
    channel.bind(
      "message-reaction",
      (data: { messageId: string; reaction: Reaction | null }) => {
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
      }
    );
    return () => {
      channel.unbind_all();
      channel.unsubscribe();
      pusher.disconnect();
    };
  }, [isJoined, isUserScrolled]);

  // ── Actions ───────────────────────────────────────────────
  const addReaction = async (messageId: string, reactionType: ReactionType) => {
    updateUserActivity();
    const message = messages.find((m) => m.id === messageId);
    const cleanReactions = sanitizeReactions(message?.reactions || []);
    const hasReacted = cleanReactions.some(
      (r) => r.userId === userIdRef.current && r.type === reactionType
    );
    const updatedReactions = hasReacted
      ? cleanReactions.filter(
          (r) => !(r.userId === userIdRef.current && r.type === reactionType)
        )
      : [
          ...cleanReactions,
          {
            type: reactionType,
            userId: userIdRef.current,
            username,
            timestamp: Date.now(),
          },
        ];
    setMessages((prev) =>
      prev.map((msg) =>
        msg.id === messageId ? { ...msg, reactions: updatedReactions } : msg
      )
    );
    try {
      await api.putReactions(messageId, updatedReactions);
      await api.sendReaction(
        messageId,
        hasReacted ? null : updatedReactions[updatedReactions.length - 1]
      );
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

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputMessage.trim() || !username) return;
    
    updateUserActivity();
    await updateLastActive();
    
    const messageId = generateId();
    const newMessage: Message = {
      id: messageId,
      text: inputMessage,
      username,
      timestamp: Date.now(),
      userId: userIdRef.current,
      status: "sending",
      reactions: [],
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

  const joinChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) return;
    localStorage.setItem("chat-username", username);
    localStorage.setItem("chat-userId", userIdRef.current);
    setIsJoined(true);
  };

  const clearSavedUser = () => {
    localStorage.removeItem("chat-username");
    localStorage.removeItem("chat-userId");
    setUsername("");
    window.location.reload();
  };

  // ── Hover Handlers ────────────────────────────────────────
  const handleMouseEnter = (messageId: string) => {
    clearTimeout(hoverTimeoutRef.current);
    setHoveredMessageId(messageId);
    updateUserActivity();
  };

  const handleMouseLeave = () => {
    hoverTimeoutRef.current = setTimeout(() => setHoveredMessageId(null), 200);
  };

  // ── Join Screen ───────────────────────────────────────────
  if (!isJoined) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl p-6 sm:p-8 max-w-md w-full">
          <div className="text-center mb-6 sm:mb-8">
            <Image
              src="/next.svg"
              alt="Logo"
              width={100}
              height={25}
              className="mx-auto dark:invert w-[80px] sm:w-[120px]"
            />
            <h2 className="text-xl sm:text-2xl font-bold text-gray-800 mt-4 sm:mt-6">
              Join the Chat
            </h2>
            <p className="text-sm sm:text-base text-gray-600 mt-2">
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
                className="w-full px-3 sm:px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm sm:text-base"
                placeholder="Enter your username"
                required
                maxLength={20}
                autoFocus
              />
            </div>
            <button
              type="submit"
              className="w-full bg-blue-500 text-white py-2 px-4 rounded-lg hover:bg-blue-600 transition-colors font-medium text-sm sm:text-base"
            >
              Join Chat
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ── Chat Screen ───────────────────────────────────────────
  return (
    <div className="h-screen flex flex-col bg-gradient-to-br from-blue-50 to-indigo-100 overflow-hidden">
      {/* Header */}
      <div className="bg-white shadow-sm border-b flex-shrink-0">
        <div className="px-3 sm:px-4 py-2 sm:py-3 flex justify-between items-center w-full lg:max-w-[70%] lg:mx-auto">
          <div className="flex items-center gap-2 sm:gap-3">
            <Image src="/next.svg" alt="Logo" width={40} height={10} className="sm:w-[60px]" />
            <h1 className="text-sm sm:text-lg font-semibold text-gray-800">
              Chat
            </h1>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Hamburger Menu Button - Mobile Only */}
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="lg:hidden p-1.5 sm:p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <svg className="h-5 w-5 sm:h-6 sm:w-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            
            {/* Desktop User Info */}
            <div className="hidden sm:flex items-center gap-3">
              <span className="text-sm text-gray-600">Logged in as:</span>
              <span className="font-medium text-gray-800 truncate max-w-[150px]">{username}</span>
              <button
                onClick={clearSavedUser}
                className="text-sm text-red-500 hover:text-red-600"
              >
                Leave
              </button>
            </div>
            
            {/* Mobile User Info */}
            <div className="sm:hidden flex items-center gap-1">
              <span className="text-xs font-medium text-gray-800 truncate max-w-[100px]">{username}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Chat Container */}
      <div className="flex-1 flex items-center justify-center p-2 sm:p-4 overflow-hidden min-h-0">
        <div className="w-full lg:max-w-[70%] h-full min-h-0">
          <div className="bg-white rounded-lg sm:rounded-xl shadow-xl overflow-hidden h-full flex flex-col">
            <div className="flex flex-row h-full min-h-0">
              {/* Online Users Sidebar - Hidden on mobile by default */}
              <div
                className={`
                  fixed lg:relative lg:block lg:w-64 w-64 bg-white border-r z-50
                  transform transition-transform duration-300 ease-in-out
                  h-full overflow-y-auto flex-shrink-0
                  ${isMobileMenuOpen ? "translate-x-0" : "-translate-x-full"}
                  lg:translate-x-0
                `}
              >
                <div className="p-2 sm:p-3 border-b bg-gradient-to-r from-blue-500 to-indigo-600 sticky top-0">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <svg className="h-3 w-3 sm:h-4 sm:w-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                      </svg>
                      <h3 className="font-semibold text-white text-[10px] sm:text-sm">
                        Active ({onlineUsers.length})
                      </h3>
                    </div>
                    <button
                      onClick={() => setIsMobileMenuOpen(false)}
                      className="lg:hidden text-white hover:text-gray-200"
                    >
                      <svg className="h-4 w-4 sm:h-5 sm:w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>
                <div>
                  {onlineUsers.length === 0 ? (
                    <p className="text-center text-gray-500 py-8 text-[10px] sm:text-sm">No active users</p>
                  ) : (
                    onlineUsers.map((user) => (
                      <UserListItem
                        key={user.id}
                        user={user}
                        isCurrentUser={user.id === userIdRef.current}
                      />
                    ))
                  )}
                </div>
              </div>

              {/* Overlay for mobile when sidebar is open */}
              {isMobileMenuOpen && (
                <div
                  className="fixed inset-0 bg-black bg-opacity-50 z-40 lg:hidden"
                  onClick={() => setIsMobileMenuOpen(false)}
                />
              )}

              {/* Chat Area */}
              <div className="flex-1 flex flex-col h-full min-h-0 relative overflow-hidden">
                {/* Load More Button */}
                {showLoadMoreButton && hasMoreMessages && !isLoading && messages.length > 0 && (
                  <div className="sticky top-0 z-10 p-1 sm:p-2 flex justify-center bg-white/95 backdrop-blur-sm border-b flex-shrink-0">
                    <button
                      onClick={loadMoreMessages}
                      disabled={isLoadingMore}
                      className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-2 sm:px-4 py-1 sm:py-2 rounded-lg text-[10px] sm:text-sm transition-colors flex items-center gap-1 sm:gap-2 shadow-md"
                    >
                      {isLoadingMore ? (
                        <>
                          <svg className="animate-spin h-2 w-2 sm:h-4 sm:w-4" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                          <span className="hidden sm:inline">Loading older messages...</span>
                          <span className="sm:hidden">Loading...</span>
                        </>
                      ) : (
                        <>
                          <svg className="h-2 w-2 sm:h-4 sm:w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                          <span className="hidden sm:inline">Load older messages</span>
                          <span className="sm:hidden">Load more</span>
                          {totalMessages > messages.length && (
                            <span className="text-[8px] sm:text-xs text-gray-500">
                              ({totalMessages - messages.length})
                            </span>
                          )}
                        </>
                      )}
                    </button>
                  </div>
                )}
                
                {/* New Message Button */}
                {showScrollButton && newMessageCount === 0 && (
                  <button
                    onClick={scrollToBottom}
                    className="absolute bottom-16 sm:bottom-20 right-2 sm:right-4 bg-blue-500 text-white rounded-full p-1 sm:p-2 shadow-lg hover:bg-blue-600 transition-colors z-10"
                  >
                    <svg className="h-3 w-3 sm:h-5 sm:w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                    </svg>
                  </button>
                )}
                
                {newMessageCount > 0 && (
                  <button
                    onClick={scrollToBottom}
                    className="absolute bottom-16 sm:bottom-20 right-2 sm:right-4 bg-blue-500 text-white rounded-full px-2 sm:px-4 py-1 sm:py-2 shadow-lg hover:bg-blue-600 transition-colors z-10 text-[10px] sm:text-sm flex items-center gap-1 sm:gap-2"
                  >
                    <svg className="h-2 w-2 sm:h-4 sm:w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                    </svg>
                    {newMessageCount}
                  </button>
                )}
                
                <div 
                  ref={messagesContainerRef}
                  onScroll={handleScroll}
                  className="flex-1 overflow-y-auto p-2 sm:p-3 space-y-2 sm:space-y-3 min-h-0"
                >
                  {isLoading && (
                    <p className="text-center text-gray-500 mt-8 text-[10px] sm:text-sm">
                      Loading messages...
                    </p>
                  )}
                  {!isLoading && messages.length === 0 && (
                    <p className="text-center text-gray-500 mt-8 text-[10px] sm:text-sm">
                      No messages yet. Start the conversation!
                    </p>
                  )}
                  {messages.map((message) => (
                    <div key={message.id} id={`msg-${message.id}`}>
                      <MessageBubble
                        message={message}
                        currentUserId={userIdRef.current}
                        isHovered={hoveredMessageId === message.id}
                        onMouseEnter={() => handleMouseEnter(message.id)}
                        onMouseLeave={handleMouseLeave}
                        onReact={(type) => addReaction(message.id, type)}
                      />
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </div>

                {/* Input Area */}
                <div className="border-t p-1.5 sm:p-3 flex-shrink-0 bg-white">
                  <form onSubmit={sendMessage}>
                    <div className="flex gap-1 sm:gap-2">
                      <input
                        type="text"
                        value={inputMessage}
                        onChange={(e) => setInputMessage(e.target.value)}
                        onFocus={updateUserActivity}
                        onClick={updateUserActivity}
                        placeholder="Type a message..."
                        className="flex-1 px-2 sm:px-3 py-1.5 sm:py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-[10px] sm:text-sm min-w-0"
                        maxLength={500}
                      />
                      <button
                        type="submit"
                        className="bg-blue-500 text-white px-2 sm:px-4 py-1.5 sm:py-2 rounded-lg hover:bg-blue-600 transition-colors font-medium text-[10px] sm:text-sm flex-shrink-0"
                      >
                        Send
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
