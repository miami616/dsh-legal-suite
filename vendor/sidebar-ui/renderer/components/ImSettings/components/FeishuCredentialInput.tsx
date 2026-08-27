import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff, ExternalLink } from 'lucide-react';

export default function FeishuCredentialInput({
    appId,
    appSecret,
    onAppIdChange,
    onAppSecretChange,
    verifyStatus,
    botName,
    showGuide = true,
}: {
    appId: string;
    appSecret: string;
    onAppIdChange: (value: string) => void;
    onAppSecretChange: (value: string) => void;
    verifyStatus: 'idle' | 'verifying' | 'valid' | 'invalid';
    botName?: string;
    showGuide?: boolean;
}) {
    const { t } = useTranslation('settings');
    const [showSecret, setShowSecret] = useState(false);
    // Local state for responsive typing, debounced save to disk
    const [localAppId, setLocalAppId] = useState(appId);
    const [localAppSecret, setLocalAppSecret] = useState(appSecret);
    const debounceIdRef = useRef<NodeJS.Timeout>(undefined);
    const debounceSecretRef = useRef<NodeJS.Timeout>(undefined);

    // Sync from parent when prop changes (e.g. config reload)
    useEffect(() => { setLocalAppId(appId); }, [appId]);
    useEffect(() => { setLocalAppSecret(appSecret); }, [appSecret]);

    const handleAppIdChange = useCallback((value: string) => {
        setLocalAppId(value);
        if (debounceIdRef.current) clearTimeout(debounceIdRef.current);
        debounceIdRef.current = setTimeout(() => onAppIdChange(value), 500);
    }, [onAppIdChange]);

    const handleAppSecretChange = useCallback((value: string) => {
        setLocalAppSecret(value);
        if (debounceSecretRef.current) clearTimeout(debounceSecretRef.current);
        debounceSecretRef.current = setTimeout(() => onAppSecretChange(value), 500);
    }, [onAppSecretChange]);

    useEffect(() => {
        return () => {
            if (debounceIdRef.current) clearTimeout(debounceIdRef.current);
            if (debounceSecretRef.current) clearTimeout(debounceSecretRef.current);
        };
    }, []);

    return (
        <div className="space-y-4">
            {/* App ID */}
            <div>
                <label className="mb-1.5 block text-xs font-medium text-[var(--ink-muted)]">
                    App ID
                </label>
                <input
                    type="text"
                    value={localAppId}
                    onChange={(e) => handleAppIdChange(e.target.value)}
                    placeholder="cli_xxxxxxxxxx"
                    className="w-full rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-sm text-[var(--ink)] placeholder-[var(--ink-subtle)] outline-none transition-colors focus:border-[var(--button-primary-bg)]"
                />
            </div>

            {/* App Secret */}
            <div>
                <label className="mb-1.5 block text-xs font-medium text-[var(--ink-muted)]">
                    App Secret
                </label>
                <div className="relative">
                    <input
                        type={showSecret ? 'text' : 'password'}
                        value={localAppSecret}
                        onChange={(e) => handleAppSecretChange(e.target.value)}
                        placeholder="xxxxxxxxxxxxxxxxxxxxxxxx"
                        className="w-full rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-2 pr-9 text-sm text-[var(--ink)] placeholder-[var(--ink-subtle)] outline-none transition-colors focus:border-[var(--button-primary-bg)]"
                    />
                    <button
                        onClick={() => setShowSecret(!showSecret)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[var(--ink-muted)] hover:text-[var(--ink)]"
                    >
                        {showSecret ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                </div>
            </div>

            {/* Status */}
            {verifyStatus === 'valid' && botName && (
                <div className="flex items-center gap-2 text-xs text-[var(--success)]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[var(--success)]" />
                    {t('agentSettings.imComponents.verified', { name: botName })}
                </div>
            )}
            {verifyStatus === 'invalid' && (
                <div className="text-xs text-[var(--error)]">
                    {t('agentSettings.imComponents.credentialsInvalid', { fields: 'App ID / App Secret' })}
                </div>
            )}

            {/* Tutorial */}
            {showGuide && (
                <div className="rounded-lg bg-[var(--paper-inset)] p-3">
                    <p className="text-xs font-medium text-[var(--ink)]">
                        {t('agentSettings.imComponents.feishuGuideTitle')}
                    </p>
                    <ol className="mt-2 space-y-1.5 text-xs text-[var(--ink-muted)]">
                        <li>1. {t('agentSettings.imComponents.feishuGuideStep1Prefix')}<a
                            href="https://open.feishu.cn/app"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mx-0.5 inline-flex items-center gap-0.5 text-[var(--button-primary-bg)] hover:underline"
                        >
                            {t('agentSettings.imComponents.feishuOpenPlatform')}<ExternalLink className="inline h-2.5 w-2.5" />
                        </a>{t('agentSettings.imComponents.feishuGuideStep1Suffix')}</li>
                        <li>2. {t('agentSettings.imComponents.feishuGuideStep2')}</li>
                        <li>3. {t('agentSettings.imComponents.feishuGuideStep3')}</li>
                        <li>4. {t('agentSettings.imComponents.feishuGuideStep4')}</li>
                    </ol>
                </div>
            )}
        </div>
    );
}
