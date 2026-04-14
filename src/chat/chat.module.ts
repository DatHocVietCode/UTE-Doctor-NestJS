import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Account, AccountSchema } from 'src/account/schemas/account.schema';
import { RedisService } from 'src/common/redis/redis.service';
import { Profile, ProfileSchema } from 'src/profile/schema/profile.schema';
import { ChatGateway } from 'src/socket/namespace/chat/chat.gateway';
import { SocketModule } from 'src/socket/socket.module';
import { ChatController } from './chat.controller';
import { ChatQueueConsumer } from './chat.queue.consumer';
import { ChatSearchService } from './chat.search.service';
import { ChatService } from './chat.service';
import { Conversation, ConversationSchema } from './schemas/conversation.schema';
import { Message, MessageSchema } from './schemas/message.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Conversation.name, schema: ConversationSchema },
      { name: Message.name, schema: MessageSchema },
      { name: Account.name, schema: AccountSchema },
      { name: Profile.name, schema: ProfileSchema },
    ]),
    SocketModule,
  ],
  controllers: [ChatController],
  providers: [ChatService, ChatGateway, ChatSearchService, ChatQueueConsumer, RedisService],
  exports: [ChatService, ChatSearchService],
})
export class ChatModule {}