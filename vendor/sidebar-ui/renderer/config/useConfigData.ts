import { useContext } from 'react';
import { ConfigDataContext, type ConfigDataValue } from './ConfigProvider';

export function useConfigData(): ConfigDataValue {
    const ctx = useContext(ConfigDataContext);
    if (!ctx) {
        throw new Error('useConfigData must be used within <ConfigProvider>');
    }
    return ctx;
}
