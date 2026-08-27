import { useContext } from 'react';
import { ConfigActionsContext, type ConfigActionsValue } from './ConfigProvider';

export function useConfigActions(): ConfigActionsValue {
    const ctx = useContext(ConfigActionsContext);
    if (!ctx) {
        throw new Error('useConfigActions must be used within <ConfigProvider>');
    }
    return ctx;
}
