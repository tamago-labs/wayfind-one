'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github.css';

/** Assistant message body: GFM markdown with code highlighting.
 * Ported from wayfind-cloud (minus VmImage — no bearer images here). */
export default function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown-body text-[15px] leading-relaxed text-navy">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer" className="font-semibold text-cta hover:underline">
              {children}
            </a>
          ),
          img: ({ src, alt }) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt={alt ?? ''} className="my-2 max-w-full rounded-xl" />
          ),
          code: ({ className, children }) => <code className={className}>{children}</code>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
