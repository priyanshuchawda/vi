import type { ChatMessage as ChatMessageType, MediaAttachment } from '../../types/chat';
import { formatFileSize } from '../../types/chat';

interface ChatMessageProps {
  message: ChatMessageType;
}

const MediaPreview = ({ attachment }: { attachment: MediaAttachment }) => {
  const getTypeIcon = (type: MediaAttachment['type']) => {
    switch (type) {
      case 'image':
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        );
      case 'video':
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        );
      case 'audio':
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
          </svg>
        );
      case 'document':
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        );
    }
  };

  const getTypeBadgeColor = (type: MediaAttachment['type']) => {
    switch (type) {
      case 'image': return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30';
      case 'video': return 'bg-purple-500/20 text-purple-300 border-purple-500/30';
      case 'audio': return 'bg-amber-500/20 text-amber-300 border-amber-500/30';
      case 'document': return 'bg-blue-500/20 text-blue-300 border-blue-500/30';
    }
  };

  return (
    <div className="mb-2">
      {attachment.type === 'image' && attachment.previewUrl ? (
        <div className="relative rounded-lg overflow-hidden max-w-[200px]">
          <img
            src={attachment.previewUrl}
            alt={attachment.name}
            className="w-full h-auto rounded-lg"
            style={{ maxHeight: '150px', objectFit: 'cover' }}
          />
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-1.5">
            <span className="text-[9px] text-white/80 font-medium">{attachment.name}</span>
          </div>
        </div>
      ) : (
        <div className={`flex items-center gap-2 p-2 rounded-lg border ${getTypeBadgeColor(attachment.type)}`}>
          {getTypeIcon(attachment.type)}
          <div className="flex flex-col min-w-0">
            <span className="text-xs font-medium truncate">{attachment.name}</span>
            <span className="text-[10px] opacity-60">{formatFileSize(attachment.size)}</span>
          </div>
        </div>
      )}
    </div>
  );
};

const ChatMessage = ({ message }: ChatMessageProps) => {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';
  const isError = message.metadata?.error === true;

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  };

  const formatTokens = (tokens: number): string => {
    if (tokens >= 1_000) {
      return `${(tokens / 1_000).toFixed(1)}K`;
    }
    return tokens.toString();
  };

  if (isSystem) {
    return (
      <div className="flex justify-center my-4">
        <div className="px-4 py-2 bg-bg-surface/50 border border-border-primary rounded-lg text-xs text-text-muted max-w-[80%] text-center">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4 group`}>
      <div className={`flex flex-col max-w-[85%] ${isUser ? 'items-end' : 'items-start'}`}>
        {/* Media attachments */}
        {message.attachments && message.attachments.length > 0 && (
          <div className={`flex flex-col gap-1 mb-1 ${isUser ? 'items-end' : 'items-start'}`}>
            {message.attachments.map(attachment => (
              <MediaPreview key={attachment.id} attachment={attachment} />
            ))}
          </div>
        )}

        {/* Message bubble */}
        <div
          className={`px-4 py-2.5 rounded-2xl ${isUser
            ? 'bg-accent text-white rounded-tr-sm'
            : isError
              ? 'bg-red-500/10 border border-red-500/30 text-red-400 rounded-tl-sm'
              : 'bg-bg-surface border border-border-primary text-text-primary rounded-tl-sm'
            }`}
        >
          <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
            {message.content}
          </p>
        </div>

        {/* Timestamp and Token Badge */}
        <div className="flex items-center gap-2 mt-1 px-2">
          <span className="text-[10px] text-text-muted opacity-0 group-hover:opacity-100 transition-opacity">
            {formatTime(message.timestamp)}
          </span>

          {/* Attachment count badge */}
          {message.attachments && message.attachments.length > 0 && (
            <span className="text-[10px] text-text-muted bg-bg-surface/50 px-1.5 py-0.5 rounded">
              📎 {message.attachments.length}
            </span>
          )}

          {/* Token Badge for Assistant Messages */}
          {!isUser && !isSystem && message.tokens && (
            <div className="relative group/tokens">
              <span className="text-[10px] text-gray-400 font-mono bg-gray-800/50 px-1.5 py-0.5 rounded cursor-help">
                🔢 {formatTokens(message.tokens.totalTokens)}
              </span>

              {/* Token Tooltip */}
              <div className="absolute left-0 bottom-full mb-1 w-44 bg-gray-800 border border-gray-700 rounded-lg p-2.5 opacity-0 invisible group-hover/tokens:opacity-100 group-hover/tokens:visible transition-all duration-200 z-50 text-[10px] shadow-xl">
                <div className="space-y-1.5">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Input:</span>
                    <span className="text-white font-mono">{formatTokens(message.tokens.promptTokens)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Output:</span>
                    <span className="text-white font-mono">{formatTokens(message.tokens.responseTokens)}</span>
                  </div>
                  {message.tokens.cachedTokens != null && message.tokens.cachedTokens > 0 && (
                    <div className="flex justify-between text-green-400">
                      <span>Cached:</span>
                      <span className="font-mono">{formatTokens(message.tokens.cachedTokens)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-semibold pt-1 border-t border-gray-700">
                    <span className="text-gray-300">Total:</span>
                    <span className="text-white font-mono">{formatTokens(message.tokens.totalTokens)}</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ChatMessage;
