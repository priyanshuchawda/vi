const TypingIndicator = () => {
  return (
    <div className="flex justify-start mb-4">
      <div className="flex items-center gap-1.5 px-4 py-3 bg-bg-surface border border-border-primary rounded-2xl rounded-tl-sm">
        <div className="w-2 h-2 bg-text-muted rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
        <div className="w-2 h-2 bg-text-muted rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
        <div className="w-2 h-2 bg-text-muted rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
      </div>
    </div>
  );
};

export default TypingIndicator;
