import React from 'react';
import { useTranslation } from 'react-i18next';
import CustomSelect from '@/components/CustomSelect';

export default function AiConfigCard({
    providerId,
    model,
    providerOptions,
    modelOptions,
    onProviderChange,
    onModelChange,
}: {
    providerId: string;
    model: string;
    providerOptions: { value: string; label: string }[];
    modelOptions: { value: string; label: string }[];
    onProviderChange: (providerId: string) => void;
	onModelChange: (model: string) => void;
}) {
    const { t } = useTranslation('settings');
    return (
        <div className="rounded-xl border border-[var(--line)] bg-[var(--paper-elevated)] p-5">
            <h3 className="mb-4 text-sm font-semibold text-[var(--ink)]">
                {t('agentSettings.imComponents.aiConfigTitle')}
            </h3>
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <div className="flex-1 pr-4">
                        <p className="text-sm font-medium text-[var(--ink)]">
                            {t('agentSettings.imComponents.provider')}
                        </p>
                        <p className="text-xs text-[var(--ink-muted)]">
                            {t('agentSettings.imComponents.providerDescription')}
                        </p>
                    </div>
                    <CustomSelect
                        value={providerId}
                        options={providerOptions}
                        onChange={onProviderChange}
                        placeholder={t('agentSettings.imComponents.providerPlaceholder')}
                        className="w-[240px]"
                    />
                </div>
                <div className="flex items-center justify-between">
                    <div className="flex-1 pr-4">
                        <p className="text-sm font-medium text-[var(--ink)]">
                            {t('agentSettings.imComponents.model')}
                        </p>
                        <p className="text-xs text-[var(--ink-muted)]">
                            {t('agentSettings.imComponents.modelDescription')}
                        </p>
                    </div>
                    <CustomSelect
                        value={model}
                        options={modelOptions}
                        onChange={onModelChange}
                        placeholder={t('agentSettings.imComponents.modelPlaceholder')}
                        className="w-[240px]"
                    />
                </div>
            </div>
        </div>
    );
}
