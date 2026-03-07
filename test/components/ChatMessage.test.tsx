import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ChatMessage from '../../src/components/Chat/ChatMessage';
import type { ChatMessage as ChatMessageType } from '../../src/types/chat';

function makeAssistantMessage(content: string): ChatMessageType {
  return {
    id: 'message-1',
    role: 'assistant',
    content,
    timestamp: Date.now(),
  };
}

describe('ChatMessage', () => {
  it('renders basic markdown formatting inside assistant messages', () => {
    render(
      <ChatMessage
        message={makeAssistantMessage(
          '# Heading\n\n**Bold text** with `code`\n\n- First item\n- Second item',
        )}
      />,
    );

    expect(screen.getByText('Heading')).toBeInTheDocument();
    expect(screen.getByText('Bold text').tagName).toBe('STRONG');
    expect(screen.getByText('code').tagName).toBe('CODE');
    expect(screen.getByText('First item').tagName).toBe('LI');
    expect(screen.getByText('Second item').tagName).toBe('LI');
  });

  it('renders links as anchors', () => {
    render(
      <ChatMessage
        message={makeAssistantMessage('Open [QuickCut](https://github.com/priyanshuchawda/vi)')}
      />,
    );

    const link = screen.getByRole('link', { name: 'QuickCut' });
    expect(link).toHaveAttribute('href', 'https://github.com/priyanshuchawda/vi');
  });
});
