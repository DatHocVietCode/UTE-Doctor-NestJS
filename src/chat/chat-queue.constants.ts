export const CHAT_MESSAGE_CREATED_QUEUE = 'chat.message.created';
export const CHAT_MESSAGE_CREATED_DEAD_LETTER_QUEUE = 'chat.message.created.dlq';
export const CHAT_MESSAGE_REDIS_CHANNEL = 'chat.message';

export type ChatWriteMode = 'dual' | 'worker';
export type ChatRealtimeMode = 'direct' | 'redis';

export type ChatMessageCreatedEvent = {
  messageId?: string;
  conversationId: string;
  senderId: string;
  senderEmail?: string;
  content: string;
  type?: 'text' | 'image' | 'file' | 'system';
  clientMessageId?: string;
  createdAt: string;
  retryCount?: number;
};
