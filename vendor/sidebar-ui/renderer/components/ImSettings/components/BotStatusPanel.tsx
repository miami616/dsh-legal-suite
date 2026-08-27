import React from 'react';
import { useTranslation } from 'react-i18next';
import type { ImBotStatus } from '../../../../shared/types/im';

export default function BotStatusPanel({ status }: { status: ImBotStatus | null }) {
    const { t } = useTranslation('settings');
    if (!status) return null;

    const dotColor = {
        online: 'bg-[var(--success)]',
        connecting: 'bg-[var(--warning)]',
        error: 'bg-[var(--error)]',
        stopped: 'bg-[var(--ink-subtle)]',
    }[status.status];

    const labelColor = {
        online: 'text-[var(--success)]',
        connecting: 'text-[var(--warning)]',
        error: 'text-[var(--error)]',
        stopped: 'text-[var(--ink-muted)]',
    }[status.status];

    const statusLabel = {
        online: t('agentSettings.imComponents.statusOnline'),
        connecting: t('agentSettings.imComponents.statusConnecting'),
        error: t('agentSettings.imComponents.statusError'),
        stopped: t('agentSettings.imComponents.statusStopped'),
    }[status.status];

    const formatUptime = (seconds: number): string => {
        if (seconds < 60) return `${seconds}s`;
        if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        return `${h}h ${m}m`;
    };

    const isActive = status.status === 'online' || status.status === 'connecting';

    return (
        <div className="flex items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--paper-elevated)] px-4 py-3 text-xs">
            {/* Status dot + label */}
            <div className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${dotColor}`} />
            <span className={`font-medium ${labelColor}`}>{statusLabel}</span>

            {isActive && (
                <>
                    <span className="text-[var(--line-strong)]">·</span>
                    <span className="text-[var(--ink-muted)]">{formatUptime(status.uptimeSeconds)}</span>
                    <span className="text-[var(--line-strong)]">·</span>
                    <span className="text-[var(--ink-muted)]">
                        {t('agentSettings.imComponents.activeSessions', { count: status.activeSessions.length })}
                    </span>
                    {status.restartCount > 0 && (
                        <>
                            <span className="text-[var(--line-strong)]">·</span>
                            <span className="text-[var(--ink-muted)]">
                                {t('agentSettings.imComponents.restartCount', { count: status.restartCount })}
                            </span>
                        </>
                    )}
                </>
            )}

            {status.errorMessage && (
                <>
                    <span className="text-[var(--line-strong)]">·</span>
                    <span className="truncate text-[var(--error)]">{status.errorMessage}</span>
                </>
            )}
        </div>
    );
}
