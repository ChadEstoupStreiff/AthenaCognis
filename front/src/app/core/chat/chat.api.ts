import { inject, Injectable } from '@angular/core';
import type {
  BackendChatMessage,
  ChatMessage,
  ChatMessageRequest,
  ChatRunState,
  ChatSession,
} from '@domain/contracts';
import { toChatMessage } from '@domain/mappers';
import { ApiClient, backendUrl } from '../api/api-client';
import { DataSync } from '../state/data-sync.service';

/** Chat sessions and messages. */
@Injectable({ providedIn: 'root' })
export class ChatApi {
  private readonly api = inject(ApiClient);
  private readonly sync = inject(DataSync);

  /**
   * Sessions, newest first.
   *
   * @returns Sessions.
   */
  sessions(): Promise<ChatSession[]> {
    return this.api.get<ChatSession[]>(backendUrl('/chat/list'));
  }

  /**
   * Create a session.
   *
   * @param title - Title.
   * @returns New session id.
   */
  async create(title: string): Promise<string> {
    const session = await this.api.post<{ id: string }>(backendUrl('/chat/create'), undefined, {
      params: { title },
    });
    this.sync.invalidate('chat');
    return session.id;
  }

  /**
   * Rename/describe a session.
   *
   * @param id - Session id.
   * @param title - Title.
   * @param description - Description.
   */
  async edit(id: string, title: string, description: string): Promise<void> {
    await this.api.put(backendUrl(`/chat/${id}/edit`), undefined, {
      params: { title, description },
    });
    this.sync.invalidate('chat');
  }

  /**
   * Delete a session.
   *
   * @param id - Session id.
   */
  async delete(id: string): Promise<void> {
    await this.api.delete(backendUrl(`/chat/${id}`));
    this.sync.invalidate('chat');
  }

  /**
   * Messages of a session, oldest first.
   *
   * @param id - Session id.
   * @returns Messages.
   */
  async messages(id: string): Promise<ChatMessage[]> {
    return (await this.api.get<BackendChatMessage[]>(backendUrl(`/chat/${id}/messages`))).map(
      toChatMessage,
    );
  }

  /**
   * Send a message (the answer is generated in the background).
   *
   * @param id - Session id.
   * @param request - Message.
   */
  async send(id: string, request: ChatMessageRequest): Promise<void> {
    await this.api.post(backendUrl(`/chat/${id}/message`), request);
  }

  /**
   * Generation state with the partial answer.
   *
   * @param id - Session id.
   * @returns State.
   */
  runState(id: string): Promise<ChatRunState> {
    return this.api.get<ChatRunState>(backendUrl(`/chat/${id}/is_running`), { silent: true });
  }

  /**
   * Stop the generation.
   *
   * @param id - Session id.
   */
  async cancel(id: string): Promise<void> {
    await this.api.post(backendUrl(`/chat/${id}/cancel`), undefined, { silent: true });
  }
}
