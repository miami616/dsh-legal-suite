// Project settings management — .claude/settings.json
import { exists, mkdir, readTextFile } from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';

import type { ProjectSettings } from '../types';
import { isBrowserDevMode, safeWriteJson } from './configStore';

const PROJECT_SETTINGS_DIR = '.claude';
const PROJECT_SETTINGS_FILE = 'settings.json';

export async function loadProjectSettings(projectPath: string): Promise<ProjectSettings> {
    if (isBrowserDevMode()) {
        return {};
    }

    try {
        const settingsDir = await join(projectPath, PROJECT_SETTINGS_DIR);
        const settingsPath = await join(settingsDir, PROJECT_SETTINGS_FILE);

        if (await exists(settingsPath)) {
            const content = await readTextFile(settingsPath);
            return JSON.parse(content);
        }
        return {};
    } catch (error) {
        console.error('[configService] Failed to load project settings:', error);
        return {};
    }
}

export async function saveProjectSettings(projectPath: string, settings: ProjectSettings): Promise<void> {
    if (isBrowserDevMode()) {
        console.log('[configService] Browser mode: skipping project settings save');
        return;
    }

    try {
        const settingsDir = await join(projectPath, PROJECT_SETTINGS_DIR);
        const settingsPath = await join(settingsDir, PROJECT_SETTINGS_FILE);

        if (!(await exists(settingsDir))) {
            console.log('[configService] Creating .claude directory:', settingsDir);
            await mkdir(settingsDir, { recursive: true });
        }

        await safeWriteJson(settingsPath, settings);
        console.log('[configService] Saved project settings to:', settingsPath);
    } catch (error) {
        console.error('[configService] Failed to save project settings:', error);
        throw error;
    }
}

