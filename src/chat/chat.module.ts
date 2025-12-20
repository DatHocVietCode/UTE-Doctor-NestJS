import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { Account, AccountSchema } from 'src/account/schemas/account.schema';
import { Profile, ProfileSchema } from 'src/profile/schema/profile.schema';
import { ChatGateway } from 'src/socket/namespace/chat/chat.gateway';
import { SocketModule } from 'src/socket/socket.module';
import { ChatController } from './chat.controller';
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
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: process.env.JWT_EXPIRES_IN },
    }),
  ],
  controllers: [ChatController],
  providers: [ChatService, ChatGateway, ChatSearchService],
  exports: [ChatService, ChatSearchService],
})
export class ChatModule {}