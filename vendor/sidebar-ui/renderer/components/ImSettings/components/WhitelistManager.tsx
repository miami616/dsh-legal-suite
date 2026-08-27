import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, X } from 'lucide-react';
import type { ImPlatform } from '../../../../shared/types/im';

export default function WhitelistManager({
    users,
    onChange,
    platform = 'telegram',
}: {
    users: string[];
    onChange: (users: string[]) => void;
    platform?: ImPlatform;
	}) {
    const { t } = useTranslation('settings');
    const [newUser, setNewUser] = useState('');
    const placeholderText = platform === 'telegram' ? t('agentSettings.imComponents.placeholderTelegram')
        : platform === 'feishu' ? t('agentSettings.imComponents.placeholderFeishu')
        : platform === 'dingtalk' ? t('agentSettings.imComponents.placeholderDingtalk')
        : t('agentSettings.imComponents.placeholderUser');

    const handleAdd = useCallback(() => {
        const trimmed = newUser.trim();
        if (!trimmed) return;
        if (users.includes(trimmed)) {
            setNewUser('');
            return;
        }
        onChange([...users, trimmed]);
        setNewUser('');
    }, [newUser, users, onChange]);

    const handleRemove = useCallback((user: string) => {
        onChange(users.filter(u => u !== user));
    }, [users, onChange]);

    // Feishu/DingTalk/OpenClaw: read-only display (users bind via BIND codes, can't know their internal ID)
    const isBindCodePlatform = platform === 'feishu' || platform === 'dingtalk' || platform.startsWith('openclaw:');
    if (isBindCodePlatform) {
        return (
            <div className="space-y-3">
                <label className="text-sm font-medium text-[var(--ink)]">
                    {t('agentSettings.imComponents.boundUsers')}
                </label>
                {users.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                        {users.map((user) => (
                            <span
                                key={user}
                                className="inline-flex items-center gap-1 rounded-full bg-[var(--paper-inset)] px-2.5 py-1 text-xs text-[var(--ink)]"
                            >
                                {user}
                                <button
                                    onClick={() => handleRemove(user)}
                                    className="rounded-full p-0.5 text-[var(--ink-muted)] hover:text-[var(--error)]"
                                >
                                    <X className="h-3 w-3" />
                                </button>
                            </span>
                        ))}
                    </div>
                ) : (
                    <p className="text-xs text-[var(--ink-muted)]">
                        {t('agentSettings.imComponents.noBoundUsers')}
                    </p>
                )}
            </div>
        );
    }

    // Telegram: manual add input + tag list
    return (
        <div className="space-y-3">
            <label className="text-sm font-medium text-[var(--ink)]">
                {t('agentSettings.imComponents.manualWhitelist')}
            </label>
            <div className="flex items-center gap-2">
                <input
                    type="text"
                    value={newUser}
                    onChange={(e) => setNewUser(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                    placeholder={placeholderText}
                    className="flex-1 rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-sm text-[var(--ink)] placeholder-[var(--ink-muted)] focus:border-[var(--focus-border)] focus:outline-none"
                />
                <button
                    onClick={handleAdd}
                    disabled={!newUser.trim()}
                    className="rounded-lg bg-[var(--button-primary-bg)] p-2 text-[var(--button-primary-text)] transition-colors hover:bg-[var(--button-primary-bg-hover)] disabled:opacity-50"
                >
                    <Plus className="h-4 w-4" />
                </button>
            </div>

            {users.length > 0 ? (
                <div className="flex flex-wrap gap-2 pt-1">
                    {users.map((user) => (
                        <span
                            key={user}
                            className="inline-flex items-center gap-1 rounded-full bg-[var(--paper-inset)] px-2.5 py-1 text-xs text-[var(--ink)]"
                        >
                            {user}
                            <button
                                onClick={() => handleRemove(user)}
                                className="rounded-full p-0.5 text-[var(--ink-muted)] hover:text-[var(--error)]"
                            >
                                <X className="h-3 w-3" />
                            </button>
                        </span>
                    ))}
                </div>
            ) : (
                <p className="text-xs text-[var(--ink-muted)]">
                    {t('agentSettings.imComponents.noWhitelistUsers')}
                </p>
            )}
        </div>
    );
}
