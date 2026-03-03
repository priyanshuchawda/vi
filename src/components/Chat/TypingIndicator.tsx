const TypingIndicator = () => {
  return (
    <div className="flex justify-start mb-4 animate-slide-up">
      <div className="flex items-center gap-1.5 px-4 py-3 bg-gradient-to-br from-bg-surface to-bg-elevated border border-border-primary rounded-2xl rounded-tl-sm shadow-lg">
        <div
          className="w-2 h-2 bg-accent rounded-full animate-bounce-subtle"
          style={{ animationDelay: '0ms' }}
        />
        <div
          className="w-2 h-2 bg-accent rounded-full animate-bounce-subtle"
          style={{ animationDelay: '150ms' }}
        />
        <div
          className="w-2 h-2 bg-accent rounded-full animate-bounce-subtle"
          style={{ animationDelay: '300ms' }}
        />
      </div>
    </div>
  );
};

export default TypingIndicator;
