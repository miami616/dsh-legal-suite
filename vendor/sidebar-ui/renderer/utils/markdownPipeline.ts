import type { ComponentProps } from 'react';
import type ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

// Sanitize schema: allow safe HTML tags from rehype-raw, strip scripts/iframes/event handlers.
// Extends the default GitHub-flavored schema with additional tags used in AI-generated content.
export const MARKDOWN_SANITIZE_SCHEMA = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    'details', 'summary',  // collapsible sections
    'mark', 'ins', 'del',  // text highlighting
    'sub', 'sup',           // subscript/superscript
    'kbd', 'var', 'samp',  // technical inline elements
  ],
  attributes: {
    ...defaultSchema.attributes,
    // Keep the default language-* class support for fenced code blocks.
    // Do not allow arbitrary class/style on raw HTML: AI/user Markdown can
    // otherwise render Tailwind or fixed-position overlay markup as live DOM.
    // KaTeX runs after this sanitizer, so its generated classes are unaffected.
    code: defaultSchema.attributes?.code ?? [],
  },
};

export const MARKDOWN_REMARK_PLUGINS_DEFAULT: ComponentProps<typeof ReactMarkdown>['remarkPlugins'] = [
  remarkGfm,
  remarkMath,
];

export const MARKDOWN_REMARK_PLUGINS_WITH_BREAKS: ComponentProps<typeof ReactMarkdown>['remarkPlugins'] = [
  remarkGfm,
  remarkMath,
  remarkBreaks,
];

export const MARKDOWN_REHYPE_PLUGINS: ComponentProps<typeof ReactMarkdown>['rehypePlugins'] = [
  rehypeRaw,
  [rehypeSanitize, MARKDOWN_SANITIZE_SCHEMA],
  rehypeKatex,
];

/**
 * Convert YAML frontmatter (---\n...\n---) to a fenced yaml code block
 * so the existing CodeBlock component renders it with syntax highlighting.
 * Only applied in raw/file-preview mode where skill/agent .md files are displayed.
 */
export function convertFrontmatter(content: string): string {
  if (!content) return '';
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  if (!match) return content;
  const yamlBlock = '```yaml\n' + match[1] + '\n```\n';
  return yamlBlock + content.slice(match[0].length);
}
