import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
// Removed direct model injection; delegate to service
import { DataResponse } from 'src/common/dto/data-respone';
import { ResponseCode as rc } from 'src/common/enum/reponse-code.enum';
import { ChatSearchService } from './chat.search.service';
import { ChatService } from './chat.service';

@Controller('/chat')
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly chatSearchService: ChatSearchService,
  ) {}

  @Post('/conversations')
  async createConversation(
    @Body() body: { participants: { accountId: string; email?: string; role: string }[]; title?: string },
  ): Promise<DataResponse<any>> {
    console.log('[ChatController] POST /conversations called with:', body);
    const conv = await this.chatService.upsertDirectConversation(body.participants, body.title);
    console.log('[ChatController] Returning conversation:', conv._id);
    return { code: rc.SUCCESS, message: 'Conversation created', data: conv };
  }

  @Get('/conversations')
  async listConversations(
    @Query('accountId') accountId: string,
    @Query('skip') skip?: string,
    @Query('limit') limit?: string,
  ): Promise<DataResponse<any>> {
    const skipNum = skip ? parseInt(skip, 10) : 0;
    const limitNum = limit ? parseInt(limit, 10) : 20;
    const result = await this.chatService.listConversationsByUser(accountId, skipNum, limitNum);
    return { code: rc.SUCCESS, message: 'Fetched conversations', data: result };
  }

  @Get('/conversations/:id/messages')
  async getMessages(
    @Param('id') id: string,
    @Query('before') before?: string,
    @Query('limit') limit?: string,
  ): Promise<DataResponse<any>> {
    console.log('[ChatController] GET /conversations/:id/messages called:', { id, before, limit });
    const msgs = await this.chatService.getMessages(id, before, limit ? parseInt(limit) : 20);
    console.log('[ChatController] Returning messages count:', msgs.length);
    return { code: rc.SUCCESS, message: 'Fetched messages', data: msgs };
  }

  @Post('/conversations/:id/read')
  async markRead(@Param('id') id: string, @Body() body: { accountId: string }): Promise<DataResponse<any>> {
    const conv = await this.chatService.markRead(id, body.accountId);
    return { code: rc.SUCCESS, message: 'Marked as read', data: conv };
  }

  @Get('/contacts/search')
  async searchContacts(
    @Query('q') q: string,
    @Query('role') role?: string,
    @Query('limit') lim?: string,
  ): Promise<DataResponse<any>> {
    const limit = Math.min(parseInt(lim || '10', 10), 25);
    const results = await this.chatSearchService.searchContacts({ q, role, limit });
    return { code: rc.SUCCESS, message: 'OK', data: results };
  }
}