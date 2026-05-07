import fs from 'fs';
import path from 'path';

export interface AdminSettings {
    googleAnalyticsId: string;
    naverVerification: string;
    bingVerification: string;
    googleVerification: string;
    headScripts: string;
    bodyScripts: string;
    adminEmails: string;
    fbPixelId?: string;
}

const SETTINGS_FILE_PATH = path.join(process.cwd(), 'admin-settings.json');

export const defaultSettings: AdminSettings = {
    googleAnalyticsId: 'G-F5D53JBZTT',
    naverVerification: '',
    bingVerification: '',
    googleVerification: 'rrqY5TvvJIAFLzGYpTukJerEWSuINFNbSTJxBSFqDy0',
    headScripts: '',
    bodyScripts: '',
    adminEmails: 'info@Nexyfab.com',
    fbPixelId: '',
};

let cachedSettings: AdminSettings | null = null;

export function getAdminSettings(): AdminSettings {
    if (cachedSettings) return cachedSettings;
    try {
        if (fs.existsSync(SETTINGS_FILE_PATH)) {
            const data = fs.readFileSync(SETTINGS_FILE_PATH, 'utf-8');
            cachedSettings = { ...defaultSettings, ...JSON.parse(data) };
            return cachedSettings!;
        }
    } catch (error) {
        console.error('Failed to read admin settings:', error);
    }
    return defaultSettings;
}

export function saveAdminSettings(settings: AdminSettings): boolean {
    try {
        fs.writeFileSync(SETTINGS_FILE_PATH, JSON.stringify(settings, null, 2), 'utf-8');
        cachedSettings = { ...defaultSettings, ...settings }; // 캐시 갱신
        return true;
    } catch (error) {
        console.error('Failed to save admin settings:', error);
        return false;
    }
}


