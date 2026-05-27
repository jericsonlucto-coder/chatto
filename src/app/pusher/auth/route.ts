// Update the Pusher initialization useEffect in your main component
useEffect(() => {
  if (!isJoined) return;

  // Enable Pusher logging for debugging (optional)
  Pusher.logToConsole = true;

  const pusher = new Pusher(bc4bbe143420c20c0e9d, {
    cluster: ap1,
    authEndpoint: "/api/pusher-auth",
    auth: {
      headers: {
        "Content-Type": "application/json",
      },
    },
  });

  // Subscribe to the private channel
  const channel = pusher.subscribe("private-chat-channel");
  
  // Bind to events
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

  // Handle connection errors
  channel.bind("pusher:subscription_error", (status: any) => {
    console.error("Subscription error:", status);
  });

  channel.bind("pusher:subscription_succeeded", () => {
    console.log("Successfully subscribed to private-chat-channel");
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
