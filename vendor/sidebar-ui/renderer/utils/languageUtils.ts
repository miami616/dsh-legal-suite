/**
 * Language utilities for file type detection
 * 
 * Shared module for language detection used by both preview and editor components.
 * Centralizes language mappings to ensure consistency between SyntaxHighlighter and Monaco.
 */

/**
 * Language configuration for a file type
 */
interface LanguageConfig {
    /** Prism language ID for SyntaxHighlighter */
    prism: string;
    /** Monaco language ID for editor */
    monaco: string;
    /** Whether to show line numbers */
    showLineNumbers: boolean;
}

/** Monaco syntax/tokenization budget. Text files can still preview/save above
 *  this size; this only decides whether we ask Monaco to colorize them. */
export const MONACO_TOKENIZATION_BYTE_BUDGET = 1024 * 1024;

/** Long single-line content (minified JSON/JS, JSONL, logs) dominates Monaco's
 *  wrap/tokenization cost. Treat it as plain text even when the extension is
 *  otherwise known. */
export const PATHOLOGICAL_LINE_LENGTH = 20_000;

/**
 * Default configuration for unknown file types
 */
const DEFAULT_CONFIG: LanguageConfig = {
    prism: 'text',
    monaco: 'plaintext',
    showLineNumbers: true,
};

/**
 * Special dotfile mappings (full filename match)
 */
const DOTFILE_MAP: Record<string, LanguageConfig> = {
    '.gitignore': { prism: 'text', monaco: 'plaintext', showLineNumbers: true },
    '.gitattributes': { prism: 'text', monaco: 'plaintext', showLineNumbers: true },
    '.editorconfig': { prism: 'ini', monaco: 'ini', showLineNumbers: true },
    '.env': { prism: 'text', monaco: 'plaintext', showLineNumbers: true },
    '.env.local': { prism: 'text', monaco: 'plaintext', showLineNumbers: true },
    '.env.development': { prism: 'text', monaco: 'plaintext', showLineNumbers: true },
    '.env.production': { prism: 'text', monaco: 'plaintext', showLineNumbers: true },
    '.npmrc': { prism: 'ini', monaco: 'ini', showLineNumbers: true },
    '.yarnrc': { prism: 'yaml', monaco: 'yaml', showLineNumbers: true },
    '.prettierrc': { prism: 'json', monaco: 'json', showLineNumbers: true },
    '.eslintrc': { prism: 'json', monaco: 'json', showLineNumbers: true },
    '.babelrc': { prism: 'json', monaco: 'json', showLineNumbers: true },
    'dockerfile': { prism: 'docker', monaco: 'dockerfile', showLineNumbers: true },
    'makefile': { prism: 'makefile', monaco: 'makefile', showLineNumbers: true },
};

/**
 * Extension-based language mappings
 */
const EXTENSION_MAP: Record<string, LanguageConfig> = {
    // JavaScript/TypeScript
    js: { prism: 'javascript', monaco: 'javascript', showLineNumbers: true },
    jsx: { prism: 'jsx', monaco: 'javascript', showLineNumbers: true },
    ts: { prism: 'typescript', monaco: 'typescript', showLineNumbers: true },
    tsx: { prism: 'tsx', monaco: 'typescript', showLineNumbers: true },
    mjs: { prism: 'javascript', monaco: 'javascript', showLineNumbers: true },
    cjs: { prism: 'javascript', monaco: 'javascript', showLineNumbers: true },

    // Web
    html: { prism: 'html', monaco: 'html', showLineNumbers: true },
    htm: { prism: 'html', monaco: 'html', showLineNumbers: true },
    css: { prism: 'css', monaco: 'css', showLineNumbers: true },
    scss: { prism: 'scss', monaco: 'scss', showLineNumbers: true },
    less: { prism: 'less', monaco: 'less', showLineNumbers: true },

    // Data/Config
    json: { prism: 'json', monaco: 'json', showLineNumbers: true },
    yaml: { prism: 'yaml', monaco: 'yaml', showLineNumbers: true },
    yml: { prism: 'yaml', monaco: 'yaml', showLineNumbers: true },
    toml: { prism: 'toml', monaco: 'ini', showLineNumbers: true }, // Monaco lacks TOML
    xml: { prism: 'xml', monaco: 'xml', showLineNumbers: true },
    ini: { prism: 'ini', monaco: 'ini', showLineNumbers: true },
    cfg: { prism: 'ini', monaco: 'ini', showLineNumbers: true },
    conf: { prism: 'ini', monaco: 'ini', showLineNumbers: true },

    // Programming Languages
    py: { prism: 'python', monaco: 'python', showLineNumbers: true },
    rb: { prism: 'ruby', monaco: 'ruby', showLineNumbers: true },
    rs: { prism: 'rust', monaco: 'rust', showLineNumbers: true },
    go: { prism: 'go', monaco: 'go', showLineNumbers: true },
    java: { prism: 'java', monaco: 'java', showLineNumbers: true },
    kt: { prism: 'kotlin', monaco: 'kotlin', showLineNumbers: true },
    swift: { prism: 'swift', monaco: 'swift', showLineNumbers: true },
    c: { prism: 'c', monaco: 'c', showLineNumbers: true },
    cpp: { prism: 'cpp', monaco: 'cpp', showLineNumbers: true },
    h: { prism: 'c', monaco: 'c', showLineNumbers: true },
    hpp: { prism: 'cpp', monaco: 'cpp', showLineNumbers: true },
    cs: { prism: 'csharp', monaco: 'csharp', showLineNumbers: true },

    // Shell
    sh: { prism: 'bash', monaco: 'shell', showLineNumbers: true },
    bash: { prism: 'bash', monaco: 'shell', showLineNumbers: true },
    zsh: { prism: 'bash', monaco: 'shell', showLineNumbers: true },
    ps1: { prism: 'powershell', monaco: 'powershell', showLineNumbers: true },

    // Documentation - no line numbers
    md: { prism: 'markdown', monaco: 'markdown', showLineNumbers: false },
    markdown: { prism: 'markdown', monaco: 'markdown', showLineNumbers: false },

    // Other
    sql: { prism: 'sql', monaco: 'sql', showLineNumbers: true },
    graphql: { prism: 'graphql', monaco: 'graphql', showLineNumbers: true },

    // Plain text - no line numbers
    txt: { prism: 'text', monaco: 'plaintext', showLineNumbers: false },
    log: { prism: 'text', monaco: 'plaintext', showLineNumbers: false },
};

const TOKENIZABLE_MONACO_LANGUAGES = new Set(
    Object.values({ ...DOTFILE_MAP, ...EXTENSION_MAP })
        .map((config) => config.monaco)
        .filter((language) => language !== 'plaintext'),
);

/**
 * Get language configuration for a file
 */
export function getLanguageConfig(filename: string): LanguageConfig {
    const lowerName = filename.toLowerCase();

    // Check dotfile mapping first
    if (DOTFILE_MAP[lowerName]) {
        return DOTFILE_MAP[lowerName];
    }

    // Get extension
    const ext = filename.split('.').pop()?.toLowerCase() ?? '';

    return EXTENSION_MAP[ext] ?? DEFAULT_CONFIG;
}

/**
 * Get Prism language identifier from file extension
 */
export function getPrismLanguage(filename: string): string {
    return getLanguageConfig(filename).prism;
}

/**
 * Get Monaco language identifier from file extension
 */
export function getMonacoLanguage(filename: string): string {
    return getLanguageConfig(filename).monaco;
}

/**
 * Detect long single-line content without regex backtracking or allocating line arrays.
 */
export function hasPathologicallyLongLine(
    content: string,
    limit = PATHOLOGICAL_LINE_LENGTH,
): boolean {
    let runLength = 0;
    for (let i = 0; i < content.length; i++) {
        if (content.charCodeAt(i) === 10) {
            runLength = 0;
            continue;
        }
        runLength++;
        if (runLength > limit) return true;
    }
    return false;
}

/**
 * Resolve the Monaco language for editable/previewed files.
 *
 * Preview/save budgets are larger than syntax highlighting budgets. Known source
 * files can be colorized up to 1MB, while unknown/plaintext files and pathological
 * long-line content stay in plaintext mode.
 */
export function getEditorMonacoLanguage(filename: string, content: string, sizeBytes: number): string {
    const language = getMonacoLanguage(filename);
    if (language === 'plaintext') return 'plaintext';
    if (!TOKENIZABLE_MONACO_LANGUAGES.has(language)) return 'plaintext';
    if (Math.max(sizeBytes, content.length) > MONACO_TOKENIZATION_BYTE_BUDGET) return 'plaintext';
    if (hasPathologicallyLongLine(content)) return 'plaintext';
    return language;
}

/**
 * Check if a file should show line numbers
 */
export function shouldShowLineNumbers(filename: string): boolean {
    return getLanguageConfig(filename).showLineNumbers;
}

/**
 * Check if a file is Markdown
 */
export function isMarkdownFile(filename: string): boolean {
    const ext = filename.split('.').pop()?.toLowerCase() ?? '';
    return ext === 'md' || ext === 'markdown';
}
