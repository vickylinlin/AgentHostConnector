import type { Logger } from './logger.js';
export type SkillSummary = {
    name: string;
    description: string;
    uri: string;
    directoryPath: string;
    skillFilePath: string;
    metadata?: Record<string, unknown>;
};
export type SkillDiagnostic = {
    severity: 'warn' | 'error';
    message: string;
    directoryPath?: string;
    skillFilePath?: string;
    name?: string;
};
export type SkillCatalog = {
    skills: SkillSummary[];
    diagnostics: SkillDiagnostic[];
};
export type SkillResource = {
    uri: string;
    mimeType: string;
    content: string;
    encoding: 'text' | 'base64';
};
export declare function loadSkillCatalog(rootDirs: string[], logger: Logger): Promise<SkillCatalog>;
export declare function listSkills(rootDirs: string[], logger: Logger): Promise<SkillSummary[]>;
export declare function createSkillUri(skillName: string, filePath: string): string;
export declare function createSkillIndex(skills: SkillSummary[]): {
    $schema: string;
    skills: {
        name: string;
        type: string;
        description: string;
        url: string;
    }[];
};
export declare function inferSkillMimeType(filePath: string): string;
export declare function readSkillResource(rootDirs: string[], skillName: string, filePath: string, logger: Logger): Promise<SkillResource>;
