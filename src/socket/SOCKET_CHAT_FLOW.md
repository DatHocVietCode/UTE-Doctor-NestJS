# 📘 Chat Socket Flow - Multiple Users in Single Namespace

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                  Namespace: /chat (SHARED)                      │
│                                                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│  │  Socket 1   │  │  Socket 2   │  │  Socket N   │            │
│  │  User A     │  │  User B     │  │  User ...   │            │
│  │  (JWT:123)  │  │  (JWT:456)  │  │             │            │
│  └─────────────┘  └─────────────┘  └─────────────┘            │
│         │                 │                 │                   │
│         └─────────┬───────┴─────────┬───────┘                  │
│                   │                 │                           │
│              ┌────▼────┐       ┌────▼────┐                     │
│              │Room:    │       │Room:    │                     │
│              │user:123 │       │user:456 │                     │
│              └────┬────┘       └────┬────┘                     │
│                   │                 │                           │
│                   └────────┬────────┘                           │
│                            │                                    │
│                       ┌────▼────┐                               │
│                       │Room:    │                               │
│                       │conv:abc │                               │
│                       └─────────┘                               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Detailed Flow

### Step 1: Connection & JWT Verification

```typescript
// Frontend
const token = localStorage.getItem('authToken');
const chatSocket = io('http://localhost:3000/chat', {
  auth: { token }  // ✅ Send JWT during connection
});
```

```typescript
// Backend - ChatGateway.afterInit()
afterInit(server: Server) {
  server.use(async (socket: Socket, next) => {
    // 1. Extract JWT from connection handshake
    const token = socket.handshake.auth?.token;
    
    // 2. Verify JWT
    const payload = await this.jwtService.verifyAsync(token);
    
    // 3. ✅ ATTACH USER CONTEXT TO SOCKET
    socket.data.user = {
      accountId: payload.accountId,
      email: payload.email,
      role: payload.role
    };
    
    next(); // Allow connection
  });
}
```

**Result**: 
- User A connects → Socket 1 (socket.data.user = {accountId: '123', ...})
- User B connects → Socket 2 (socket.data.user = {accountId: '456', ...})
- User C connects → Socket 3 (socket.data.user = {accountId: '789', ...})

---

### Step 2: Join User Room (Personal Notifications)

```typescript
// Frontend - User A
chatSocket.emit('CHAT_JOIN_USER');  // ❌ NO accountId needed!
```

```typescript
// Backend - ChatGateway
@SubscribeMessage(SocketEventsEnum.CHAT_JOIN_USER)
async handleJoinUser(
  @ConnectedSocket() client: Socket,
  @WsUser() user: JwtSocketPayload,  // ✅ Extract from socket.data.user
) {
  const accountId = user.accountId;  // ✅ '123' for User A (from JWT)
  await client.join(`user:${accountId}`);
  
  console.log(`User ${accountId} joined room user:${accountId}`);
}
```

**Result**:
```
Namespace /chat:
├── Socket 1 (User A) → Room: user:123
├── Socket 2 (User B) → Room: user:456
└── Socket 3 (User C) → Room: user:789
```

---

### Step 3: Join Conversation Room (Chat with Others)

```typescript
// Frontend - User A opens chat with User B
chatSocket.emit('CHAT_JOIN_CONVERSATION', { 
  conversationId: 'conv-abc-123' 
});

// Frontend - User B opens the same chat
chatSocket.emit('CHAT_JOIN_CONVERSATION', { 
  conversationId: 'conv-abc-123' 
});
```

```typescript
// Backend - ChatGateway
@SubscribeMessage(SocketEventsEnum.CHAT_JOIN_CONVERSATION)
async handleJoinConversation(
  @ConnectedSocket() client: Socket,
  @MessageBody() payload: { conversationId: string },
) {
  await client.join(`conv:${payload.conversationId}`);
  
  // Optional: Check if user is participant in this conversation
  // const user = (client.data as any).user;
  // await this.chatService.verifyParticipant(payload.conversationId, user.accountId);
}
```

**Result**:
```
Namespace /chat:
├── Socket 1 (User A)
│   ├── Room: user:123
│   └── Room: conv:abc-123  ← Joined conversation
├── Socket 2 (User B)
│   ├── Room: user:456
│   └── Room: conv:abc-123  ← Joined same conversation
└── Socket 3 (User C)
    ├── Room: user:789
    └── Room: conv:xyz-789  ← Different conversation
```

---

### Step 4: Send Message

```typescript
// Frontend - User A sends message
chatSocket.emit('CHAT_MESSAGE_SEND', {
  conversationId: 'conv-abc-123',
  content: 'Hello User B!'
  // ❌ NO senderId - extracted from JWT!
});
```

```typescript
// Backend - ChatGateway
@SubscribeMessage(SocketEventsEnum.CHAT_MESSAGE_SEND)
async handleSendMessage(
  @WsUser() user: JwtSocketPayload,  // ✅ User A (accountId: 123)
  @MessageBody() payload: { conversationId: string; content: string },
) {
  const senderId = user.accountId;  // ✅ '123' from JWT
  
  // 1. Save message to database
  const saved = await this.chatService.createMessage({
    conversationId: payload.conversationId,
    senderId: senderId,  // ✅ Guaranteed to be User A
    content: payload.content,
  });
  
  // 2. Broadcast to conversation room (users currently viewing chat)
  this.server
    .to(`conv:${payload.conversationId}`)
    .emit('CHAT_MESSAGE_RECEIVED', saved);
  
  // 3. Also notify recipient's personal room (for badge/notification)
  const conv = await this.chatService.getConversation(payload.conversationId);
  conv.participants.forEach(p => {
    if (p.accountId !== senderId) {
      this.server
        .to(`user:${p.accountId}`)  // User B's personal room
        .emit('CHAT_MESSAGE_RECEIVED', saved);
    }
  });
}
```

**Broadcasting**:
```
User A sends message:
├── Emit to Room: conv:abc-123  (User A, User B receive - they're viewing chat)
└── Emit to Room: user:456      (User B also gets notification even if not in chat page)
```

---

### Step 5: Read Message

```typescript
// Frontend - User B reads messages
chatSocket.emit('CHAT_MESSAGE_READ', {
  conversationId: 'conv-abc-123'
  // ❌ NO accountId needed!
});
```

```typescript
// Backend - ChatGateway
@SubscribeMessage(SocketEventsEnum.CHAT_MESSAGE_READ)
async handleRead(
  @WsUser() user: JwtSocketPayload,  // ✅ User B (accountId: 456)
  @MessageBody() payload: { conversationId: string },
) {
  const accountId = user.accountId;  // ✅ '456' from JWT
  
  // Mark messages as read
  await this.chatService.markRead(payload.conversationId, accountId);
  
  // Notify User A that User B read the messages
  this.server
    .to(`conv:${payload.conversationId}`)
    .emit('CHAT_MESSAGE_READ', {
      conversationId: payload.conversationId,
      readBy: accountId,  // ✅ User B
    });
}
```

---

## Security Benefits

### ❌ Before (Vulnerable):
```typescript
// Client could impersonate anyone
socket.emit('CHAT_MESSAGE_SEND', {
  senderId: 'victim-id-789',  // ❌ Pretend to be someone else
  content: 'Malicious message'
});
```

### ✅ After (Secure):
```typescript
// Client cannot fake identity
socket.emit('CHAT_MESSAGE_SEND', {
  // senderId removed - extracted from JWT on server
  content: 'Safe message'
});

// Backend knows who you are from JWT
@WsUser() user → { accountId: '123' }  // From verified JWT
```

---

## Key Takeaways

1. **1 Namespace = Many Users**: All users share `/chat` namespace
2. **Rooms Separate Users**: Each user has personal room `user:{id}`
3. **JWT Context**: `socket.data.user` stores verified identity
4. **@WsUser Decorator**: Extract user context safely in handlers
5. **Never Trust Client**: Always use JWT context, never payload for identity

---

## Example: Real World Scenario

```
Hospital App Chat:

Doctor A (id: doc-123)
  → Socket 1 in /chat
  → Rooms: [user:doc-123]
  → Opens chat with Patient X
  → Joins Room: conv:abc

Patient X (id: pat-456)
  → Socket 2 in /chat
  → Rooms: [user:pat-456]
  → Opens chat with Doctor A
  → Joins Room: conv:abc

Patient Y (id: pat-789)
  → Socket 3 in /chat
  → Rooms: [user:pat-789]
  → Opens chat with Doctor B
  → Joins Room: conv:xyz

All 3 users in SAME namespace /chat, but isolated by rooms!
```

---

## Testing

```javascript
// Test with multiple browser tabs
// Tab 1: User A
const socketA = io('/chat', { auth: { token: tokenA } });
socketA.emit('CHAT_JOIN_USER');  // Joins user:123

// Tab 2: User B
const socketB = io('/chat', { auth: { token: tokenB } });
socketB.emit('CHAT_JOIN_USER');  // Joins user:456

// Both join same conversation
socketA.emit('CHAT_JOIN_CONVERSATION', { conversationId: 'conv-1' });
socketB.emit('CHAT_JOIN_CONVERSATION', { conversationId: 'conv-1' });

// User A sends message
socketA.emit('CHAT_MESSAGE_SEND', { 
  conversationId: 'conv-1',
  content: 'Hi B!' 
});

// → User B receives in both Tab 2 (user:456 room AND conv:1 room)
```
