import { Body, Controller, Get, Param, Post, Query, Req, UseGuards, UnauthorizedException } from '@nestjs/common';
// Removed direct model injection; delegate to service
import { DataResponse } from 'src/common/dto/data-respone';
import { ResponseCode as rc } from 'src/common/enum/reponse-code.enum';
import { JwtAuthGuard } from 'src/common/guards/jws-auth.guard';
import { AuthUser } from 'src/common/interfaces/auth-user';
import { ChatSearchService } from './chat.search.service';
import { ChatService } from './chat.service';

@Controller('/chat')
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly chatSearchService: ChatSearchService,
  ) {}

  @Post('/conversations')
  @UseGuards(JwtAuthGuard)
  async createConversation(
    @Req() req: any,
    @Body() body: { participants: { accountId: string; email?: string; role: string }[]; title?: string },
  ): Promise<DataResponse<any>> {
    const user = req.user as AuthUser;
    if (!user?.accountId || !user?.role) {
      throw new UnauthorizedException('Unable to identify user from token');
    }
    console.log('[ChatController] POST /conversations called with:', body);
    const participants = Array.isArray(body.participants) ? [...body.participants] : [];
    const userIndex = participants.findIndex(p => p.accountId === user.accountId);
    const userParticipant = { accountId: user.accountId, email: user.email, role: user.role };
    if (userIndex >= 0) {
      participants[userIndex] = { ...participants[userIndex], ...userParticipant };
    } else {
      participants.push(userParticipant);
    }
    const conv = await this.chatService.upsertDirectConversation(participants, body.title);
    console.log('[ChatController] Returning conversation:', conv._id);
    return { code: rc.SUCCESS, message: 'Conversation created', data: conv };
  }

  @Get('/conversations')
  @UseGuards(JwtAuthGuard)
  async listConversations(
    @Req() req: any,
    @Query('skip') skip?: string,
    @Query('limit') limit?: string,
  ): Promise<DataResponse<any>> {
    const user = req.user as AuthUser;
    const skipNum = skip ? parseInt(skip, 10) : 0;
    const limitNum = limit ? parseInt(limit, 10) : 20;
    const result = await this.chatService.listConversationsByUser(user, skipNum, limitNum);
    return { code: rc.SUCCESS, message: 'Fetched conversations', data: result };
  }

  @Get('/conversations/:id/messages')
  @UseGuards(JwtAuthGuard)
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
  @UseGuards(JwtAuthGuard)
  async markRead(@Req() req: any, @Param('id') id: string): Promise<DataResponse<any>> {
    const user = req.user as AuthUser;
    const conv = await this.chatService.markRead(id, user);
    return { code: rc.SUCCESS, message: 'Marked as read', data: conv };
  }

  @Get('/contacts/search')
  @UseGuards(JwtAuthGuard)
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
