import { Fragment, type ReactNode } from 'react';

function renderInlineMarkdown(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const pattern =
    /(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\n]+)\*|_([^_\n]+)_|~~([^~]+)~~)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    if (match[2] && match[3]) {
      parts.push(
        <a
          key={`${match.index}-link`}
          href={match[3]}
          target="_blank"
          rel="noreferrer noopener"
          className="text-sky-300 underline decoration-sky-300/40 underline-offset-2"
        >
          {match[2]}
        </a>,
      );
    } else if (match[4]) {
      parts.push(
        <code
          key={`${match.index}-code`}
          className="rounded bg-black/35 px-1.5 py-0.5 font-mono text-[0.92em] text-amber-200"
        >
          {match[4]}
        </code>,
      );
    } else if (match[5] || match[6]) {
      parts.push(<strong key={`${match.index}-strong`}>{match[5] || match[6]}</strong>);
    } else if (match[7] || match[8]) {
      parts.push(<em key={`${match.index}-em`}>{match[7] || match[8]}</em>);
    } else if (match[9]) {
      parts.push(
        <span key={`${match.index}-strike`} className="line-through opacity-80">
          {match[9]}
        </span>,
      );
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}

function renderParagraphLines(lines: string[]): ReactNode[] {
  return lines.flatMap((line, index) => {
    const content = renderInlineMarkdown(line);
    if (index === lines.length - 1) {
      return content;
    }
    return [...content, <br key={`br-${index}`} />];
  });
}

export function renderChatMarkdown(markdown: string): ReactNode {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    const fenceMatch = trimmed.match(/^```(\w+)?$/);
    if (fenceMatch) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith('```')) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      blocks.push(
        <pre
          key={`code-${blocks.length}`}
          className="my-2 overflow-x-auto rounded-lg border border-white/6 bg-black/35 p-3 font-mono text-[12px] leading-6 text-slate-200"
        >
          <code>{codeLines.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const sizeClass = level === 1 ? 'text-base' : level === 2 ? 'text-[15px]' : 'text-[14px]';
      blocks.push(
        <div
          key={`heading-${blocks.length}`}
          className={`mt-1 font-semibold leading-6 text-white ${sizeClass}`}
        >
          {renderInlineMarkdown(headingMatch[2])}
        </div>,
      );
      index += 1;
      continue;
    }

    if (/^[-*+]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*+]\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^[-*+]\s+/, ''));
        index += 1;
      }
      blocks.push(
        <ul
          key={`ul-${blocks.length}`}
          className="my-2 list-disc space-y-1 pl-5 text-[13px] leading-6"
        >
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>{renderInlineMarkdown(item)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^\d+\.\s+/, ''));
        index += 1;
      }
      blocks.push(
        <ol
          key={`ol-${blocks.length}`}
          className="my-2 list-decimal space-y-1 pl-5 text-[13px] leading-6"
        >
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>{renderInlineMarkdown(item)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length) {
      const candidate = lines[index];
      const candidateTrimmed = candidate.trim();
      if (
        !candidateTrimmed ||
        candidateTrimmed.startsWith('```') ||
        /^#{1,6}\s+/.test(candidate) ||
        /^[-*+]\s+/.test(candidateTrimmed) ||
        /^\d+\.\s+/.test(candidateTrimmed)
      ) {
        break;
      }
      paragraphLines.push(candidate);
      index += 1;
    }

    blocks.push(
      <p key={`p-${blocks.length}`} className="my-2 text-[13px] leading-7 text-inherit">
        {renderParagraphLines(paragraphLines)}
      </p>,
    );
  }

  return blocks.map((block, blockIndex) => <Fragment key={blockIndex}>{block}</Fragment>);
}
