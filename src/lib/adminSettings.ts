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
    /**
     * Landing-page social proof numbers. Configurable so we can scale them
     * up as the partner DB grows without code edits. The string literal is
     * inserted verbatim (so admin can write "30만+", "300K+", "10,000+",
     * etc.) — the i18n dict reads `landingFactoryCount` for the headline
     * and `landingFactoryCountQualifier` (e.g. "한·중", "verified") so the
     * claim stays specific and defensible.
     *
     * Per the no-mock policy: until we can defend a higher number with a
     * data-source citation, the default deliberately understates ("10K+")
     * rather than the inherited "300K+" headline figure.
     */
    landingFactoryCount?: string;
    landingFactoryCountQualifier?: string;
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
    // Defensible until partner DB ingestion is verified. Operator increases
    // this in admin-settings.json once the registry counts are confirmed.
    landingFactoryCount: '10,000+',
    landingFactoryCountQualifier: 'verified',
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


