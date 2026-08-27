import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff, ExternalLink } from 'lucide-react';

export default function DingtalkCredentialInput({
    clientId,
    clientSecret,
    onClientIdChange,
    onClientSecretChange,
    verifyStatus,
    botName,
    showGuide = true,
}: {
    clientId: string;
    clientSecret: string;
    onClientIdChange: (value: string) => void;
    onClientSecretChange: (value: string) => void;
    verifyStatus: 'idle' | 'verifying' | 'valid' | 'invalid';
    botName?: string;
    showGuide?: boolean;
}) {
    const { t } = useTranslation('settings');
    const [showSecret, setShowSecret] = useState(false);
    const [localClientId, setLocalClientId] = useState(clientId);
    const [localClientSecret, setLocalClientSecret] = useState(clientSecret);
    const debounceIdRef = useRef<NodeJS.Timeout>(undefined);
    const debounceSecretRef = useRef<NodeJS.Timeout>(undefined);

    useEffect(() => { setLocalClientId(clientId); }, [clientId]);
    useEffect(() => { setLocalClientSecret(clientSecret); }, [clientSecret]);

    const handleClientIdChange = useCallback((value: string) => {
        setLocalClientId(value);
        if (debounceIdRef.current) clearTimeout(debounceIdRef.current);
        debounceIdRef.current = setTimeout(() => onClientIdChange(value), 500);
    }, [onClientIdChange]);

    const handleClientSecretChange = useCallback((value: string) => {
        setLocalClientSecret(value);
        if (debounceSecretRef.current) clearTimeout(debounceSecretRef.current);
        debounceSecretRef.current = setTimeout(() => onClientSecretChange(value), 500);
    }, [onClientSecretChange]);

    useEffect(() => {
        return () => {
            if (debounceIdRef.current) clearTimeout(debounceIdRef.current);
            if (debounceSecretRef.current) clearTimeout(debounceSecretRef.current);
        };
    }, []);

    return (
        <div className="space-y-4">
            {/* Client ID */}
            <div>
                <label className="mb-1.5 block text-xs font-medium text-[var(--ink-muted)]">
                    Client ID (AppKey)
                </label>
                <input
                    type="text"
                    value={localClientId}
                    onChange={(e) => handleClientIdChange(e.target.value)}
                    placeholder="dingxxxxxxxxxx"
                    className="w-full rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-sm text-[var(--ink)] placeholder-[var(--ink-subtle)] outline-none transition-colors focus:border-[var(--button-primary-bg)]"
                />
            </div>

            {/* Client Secret */}
            <div>
                <label className="mb-1.5 block text-xs font-medium text-[var(--ink-muted)]">
                    Client Secret (AppSecret)
                </label>
                <div className="relative">
                    <input
                        type={showSecret ? 'text' : 'password'}
                        value={localClientSecret}
                        onChange={(e) => handleClientSecretChange(e.target.value)}
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
                    {botName}
                </div>
            )}
            {verifyStatus === 'invalid' && (
                <div className="text-xs text-[var(--error)]">
                    {t('agentSettings.imComponents.credentialsInvalid', { fields: 'Client ID / Client Secret' })}
                </div>
            )}

            {/* Tutorial */}
            {showGuide && (
                <div className="rounded-lg bg-[var(--paper-inset)] p-3">
                    <p className="text-xs font-medium text-[var(--ink)]">
                        {t('agentSettings.imComponents.dingtalkGuideTitle')}
                    </p>
                    <ol className="mt-2 space-y-1.5 text-xs text-[var(--ink-muted)]">
                        <li>1. {t('agentSettings.imComponents.dingtalkGuideStep1Prefix')}<a
                            href="https://open-dev.dingtalk.com"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mx-0.5 inline-flex items-center gap-0.5 text-[var(--button-primary-bg)] hover:underline"
                        >
                            {t('agentSettings.imComponents.dingtalkOpenPlatform')}<ExternalLink className="inline h-2.5 w-2.5" />
                        </a>{t('agentSettings.imComponents.dingtalkGuideStep1Suffix')}</li>
                        <li>2. {t('agentSettings.imComponents.dingtalkGuideStep2')}</li>
                        <li>3. {t('agentSettings.imComponents.dingtalkGuideStep3')}</li>
                        <li>4. {t('agentSettings.imComponents.dingtalkGuideStep4')}</li>
                    </ol>
                </div>
            )}
        </div>
    );
}
