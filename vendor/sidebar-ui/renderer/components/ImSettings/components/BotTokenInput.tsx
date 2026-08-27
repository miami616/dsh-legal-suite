import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Check, Eye, EyeOff, Loader2 } from 'lucide-react';

export default function BotTokenInput({
    value,
    onChange,
    verifyStatus,
    botUsername,
}: {
    value: string;
    onChange: (token: string) => void;
    verifyStatus: 'idle' | 'verifying' | 'valid' | 'invalid';
    botUsername?: string;
	}) {
    const { t } = useTranslation('settings');
    const [visible, setVisible] = useState(false);
    const [localValue, setLocalValue] = useState(value);

    // Sync from parent when value prop changes
    useEffect(() => {
        setLocalValue(value);
    }, [value]);

    const handleBlur = useCallback(() => {
        const trimmed = localValue.trim();
        if (trimmed !== value) {
            onChange(trimmed);
        }
    }, [localValue, value, onChange]);

    return (
        <div className="space-y-2">
            <label className="text-sm font-medium text-[var(--ink)]">Bot Token</label>
            <div className="flex items-center gap-2">
                <div className="relative flex-1">
                    <input
                        type={visible ? 'text' : 'password'}
                        value={localValue}
                        onChange={(e) => setLocalValue(e.target.value)}
                        onBlur={handleBlur}
                        onKeyDown={(e) => e.key === 'Enter' && handleBlur()}
                        placeholder={t('agentSettings.imComponents.tokenPlaceholder')}
                        className="w-full rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-2 pr-10 text-sm text-[var(--ink)] placeholder-[var(--ink-muted)] focus:border-[var(--focus-border)] focus:outline-none"
                    />
                    <button
                        type="button"
                        onClick={() => setVisible(!visible)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-[var(--ink-muted)] hover:text-[var(--ink)]"
                    >
                        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                </div>
                {/* Verify status indicator */}
                {verifyStatus === 'verifying' && (
                    <Loader2 className="h-4 w-4 animate-spin text-[var(--ink-muted)]" />
                )}
                {verifyStatus === 'valid' && (
                    <Check className="h-4 w-4 text-[var(--success)]" />
                )}
                {verifyStatus === 'invalid' && (
                    <AlertCircle className="h-4 w-4 text-[var(--error)]" />
                )}
            </div>
            {verifyStatus === 'valid' && botUsername && (
                <p className="text-xs text-[var(--success)]">
                    {t('agentSettings.imComponents.verified', { name: `@${botUsername}` })}
                </p>
            )}
            {verifyStatus === 'invalid' && (
                <p className="text-xs text-[var(--error)]">
                    {t('agentSettings.imComponents.tokenInvalid')}
                </p>
            )}
        </div>
    );
}
